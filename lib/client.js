// dsh-wsl — Client half (hand-written web plugin bundle).
//
// The module table format mirrors a tsdown client bundle: a factory registered
// via window.__ModuleLoader__.load; the factory returns the plugin exports
// surface (apply). The only module dependency is react, a platform seed word.
// It registers one plugin-configuration card in the Web Plugins settings
// (`settings.plugin.item`): a compact horizontal row with the distro picker,
// live distro list, preset status, and warm-up, backed by the host half's
// same-origin JSON API under /wsl-manager/*.
window.__ModuleLoader__.load({
	id: "dsh-wsl",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		const React = require("react");

		function el(type, props, ...children) {
			return React.createElement(type, props, ...children);
		}

		function errText(e) {
			if (e == null) return "unknown error";
			if (typeof e === "object" && e.message != null) return String(e.message);
			return String(e);
		}

		async function api(path, body) {
			const res = await fetch("/wsl-manager" + path, body === undefined
				? { method: "GET" }
				: { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
			const text = await res.text();
			let data = null;
			try { data = text ? JSON.parse(text) : null; } catch { data = null; }
			if (!res.ok) {
				throw new Error((data && data.error) || "HTTP " + res.status);
			}
			if (data === null) {
				// The SPA fallback answered instead of the host API: the host
				// half is not mounted (or failed). Fail loud instead of
				// showing a perpetual loading state.
				throw new Error("wsl-manager API returned a non-JSON response — the dsh-wsl host half is not mounted");
			}
			return data;
		}

		const S = {
			card: { border: "1px solid var(--color-border, #e5e5e5)", borderRadius: 8, padding: "10px 12px", display: "flex", flexDirection: "column", gap: 8 },
			head: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" },
			title: { fontSize: 13, fontWeight: 600 },
			row: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" },
			select: { padding: "4px 8px", border: "1px solid var(--color-border, #ccc)", borderRadius: 6, fontSize: 12, background: "var(--color-bg, transparent)", color: "var(--color-text, inherit)", maxWidth: 220 },
			btn: { padding: "4px 10px", border: "1px solid var(--color-border, #ccc)", borderRadius: 6, background: "transparent", fontSize: 12, cursor: "pointer", color: "var(--color-text, inherit)" },
			note: { fontSize: 12, color: "var(--color-text-secondary, #888)", lineHeight: 1.6 },
			error: { color: "#dc2626", fontSize: 12 },
			ok: { color: "#15803d", fontSize: 12 },
			badgeOn: { fontSize: 11, padding: "1px 7px", borderRadius: 10, border: "1px solid #16a34a", color: "#15803d" },
			badgeOff: { fontSize: 11, padding: "1px 7px", borderRadius: 10, border: "1px solid #9ca3af", color: "#9ca3af" },
			details: { display: "flex", flexDirection: "column", gap: 4 },
		};

		function WslCard() {
			const [status, setStatus] = React.useState(null);
			const [error, setError] = React.useState(null);
			const [busy, setBusy] = React.useState(false);
			const [saving, setSaving] = React.useState(false);
			const [saveMsg, setSaveMsg] = React.useState(null);
			const [expanded, setExpanded] = React.useState(false);
			const [saveFailed, setSaveFailed] = React.useState(false);

			async function refresh() {
				setBusy(true);
				setError(null);
				try {
					setStatus(await api("/status"));
				} catch (e) {
					setError(errText(e));
					setStatus(null);
				} finally {
					setBusy(false);
				}
			}

			async function chooseDistro(value) {
				setSaving(true);
				setSaveMsg(null);
				try {
					const r = await api("/distro", { distro: value });
					setSaveMsg(r.ok ? "Сохранено (применено)" : "Не сохранено");
					setSaveFailed(!r.ok);
					await refresh();
				} catch (e) {
					setSaveMsg(errText(e));
					setSaveFailed(true);
				} finally {
					setSaving(false);
				}
			}

			async function warmup() {
				setSaveMsg(null);
				try {
					const r = await api("/warmup", {});
					setSaveMsg(r.ok ? "Прогрев запущен" : "Прогрев не запустился");
					setSaveFailed(!r.ok);
				} catch (e) {
					setSaveMsg(errText(e));
					setSaveFailed(true);
				}
			}

			React.useEffect(() => { refresh(); }, []);

			const distros = (status && status.distros) || [];
			const saved = status ? status.savedDistro : null;
			const fallback = status ? status.defaultDistro : null;
			const current = saved !== null && saved !== "" ? saved : (fallback ?? "");
			const anyRunning = distros.some((d) => d.state === "Running");
			const saveIsError = saveFailed;

			return el("div", { style: S.card },
				el("div", { style: S.head },
					el("span", { style: S.title }, "WSL"),
					el("span", { style: S.note }, "команды выполняются в WSL"),
					el("span", { style: { marginLeft: "auto" } },
						status === null
							? null
							: status.available
								? el("span", { style: S.badgeOn }, "доступен")
								: el("span", { style: S.badgeOff }, "недоступен"),
					),
				),
				error ? el("div", { style: S.error }, error) : null,
				status === null ? el("div", { style: S.row },
					el("span", { style: S.note }, busy ? "Загрузка…" : "Загрузка…"),
				) : el("div", { style: S.row },
					el("label", { style: S.row },
						el("span", { style: S.note }, "дистрибутив"),
						el("select", {
							style: S.select,
							value: current,
							disabled: saving || !status.available || distros.length === 0,
							onChange: (e) => chooseDistro(e.target.value),
						},
							el("option", { key: "", value: "" }, "по умолчанию (" + (fallback ?? "не задан") + ")"),
							distros.map((d) => el("option", { key: d.name, value: d.name },
								d.name + (d.isDefault ? " (по умолчанию)" : "") + " · " + d.state,
							)),
						),
					),
					saving ? el("span", { style: S.note }, "Сохранение…") : null,
					saveMsg !== null ? el("span", { style: saveIsError ? S.error : S.ok }, saveMsg) : null,
					el("span", { style: S.note }, anyRunning ? "есть запущенные дистрибутивы" : "все остановлены (первый вызов запустит)"),
					el("button", { style: S.btn, onClick: warmup, disabled: !status.available }, "Прогреть"),
					el("span", { style: S.note },
						status.preset && status.preset.installed
							? "пресет minimal-wsl установлен ✓"
							: "пресет minimal-wsl не установлен (ставится при загрузке Host)",
					),
				),
				status === null ? null : el("div", { style: S.row },
					el("button", { style: S.btn, onClick: () => setExpanded(!expanded) }, expanded ? "Свернуть ▴" : "Как пользоваться ▾"),
					el("button", { style: S.btn, onClick: refresh, disabled: busy }, busy ? "Обновление…" : "Обновить"),
				),
				expanded ? el("div", { style: S.details },
					el("div", { style: S.note }, "• Пути: файловые инструменты используют Windows-пути (D:\\dir\\file), bash — пути WSL (/mnt/d/dir/file); это одни и те же файлы."),
					el("div", { style: S.note }, "• Песочница: процессы в WSL не ограничены Windows-песочницей; инструменты bash/wsl разрешены только в режиме «полный доступ», иначе вернётся понятная подсказка."),
					el("div", { style: S.note }, "• Пресет: в новом чате выберите «极简模式 (WSL)» — bash пойдёт в WSL (обычный и постоянный PTY)."),
					el("div", { style: S.note }, "• Ограничения: нет stdin (используйте heredoc); /mnt/* идёт через 9P, тяжёлые сборки лучше держать в домашнем каталоге WSL."),
				) : null,
			);
		}

		function apply(ctx) {
			const slots = ctx.get("slots");
			if (slots === undefined) return;
			slots.inject("plugins.bundle.config", () => slots.register(
				{ name: "plugins.bundle.config", key: "dsh-wsl" },
				() => el(WslCard),
			));
		}

		exports.inject = ["slots"];
		exports.apply = apply;
		return module.exports;
	}
});
