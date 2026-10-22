# dsh-brand-custom

Replace the four places DeepSeek Harness paints its own brand — the sidebar's
mark and wordmark, and the new-session page's mark and headline — from a
**Settings → Brand** page (in Chinese: 设置 → 品牌自定义).

Everything is optional. A field you leave empty keeps the official artwork or
copy, so an untouched install behaves exactly like a stock one.

| Slot | Default | What you can set |
| --- | --- | --- |
| Sidebar mark | the DeepSeek fish | PNG / JPEG / WebP / SVG, up to 4 MB |
| Sidebar wordmark | `deepseek` + `HARNESS` badge | two independent labels |
| New-session mark | the animated hero fish | PNG / JPEG / WebP / SVG, up to 4 MB |
| New-session headline | `探索未至之境` (localized) | headline and its preview badge |

中文说明见 [README.zh-CN.md](README.zh-CN.md)。

## Install

```sh
dsh plugin --profile <name> add https://github.com/what-is-me/dsh-brand-custom
```

`<name>` is the profile you run, for example `desktop`. The argument is the
repository URL, not a path: the plugin manager recognises a hosted repository
URL as a git spec, checks the GitHub connection anonymously before pnpm starts,
and records the dependency as `github:what-is-me/dsh-brand-custom` in the
profile manifest.

The package declares `dsh.bundle.patch`, so the same command that installs it
also appends `dsh-brand-custom` to the profile's bundle list — no manual
`cordis.patch.yml` edit. Restart the app (or reload the page after a client
rebuild) and the section appears in Settings.

Pin a revision or tag by appending it: `…dsh-brand-custom#v0.1.0`.

To remove it: `dsh plugin --profile <name> remove dsh-brand-custom`, then drop
`dsh-brand-custom` from `dsh.profile.bundles` if it is still listed.

Working from a local checkout instead? `dsh plugin --profile <name> add
link:/absolute/path/to/dsh-brand-custom` installs the same package without a
clone, and is what you want while editing it.

## How the four slots are taken over

The host paints its brand through three single slots and one hard-coded line:

- `sidebar.brand.mark` — the rail and expanded-header fish, `{ size: 24 }`.
- `sidebar.brand.name` — the wordmark text, no owner props.
- `conversation.hero.brand.mark` — the hero fish, `{ size: 34, className }`.
- The hero headline has **no slot**: the host renders it from its own locale
  dictionary into a span inside the `Hqq-bq_titleGroup` frame.

The plugin therefore does two different things:

1. **Slots.** `@deepseek-ai/dsh-client-ui-brand-official` occupies the first
   three at the default priority (0). This plugin registers at **priority -1**,
   which the slot service resolves as "lowest renders", so the registration
   shadows the official occupant while it exists. The registration lives only
   while the reader has supplied that value: clearing a field disposes it and
   the official brand comes straight back — no repaint logic needed.
2. **Headline text.** The span is rewritten on the DOM, with the host's own
   text captured before the first write so clearing the field restores it. A
   `MutationObserver` keeps it rewritten across language switches and hero
   remounts, and disconnects entirely once nothing is customized. The frame is
   found through the mark slot's own outlet
   (`[data-slot="conversation.hero.brand.mark"]`), so no hashed class name is
   ever written down here.

## Storage

The node half owns everything; the browser half only reads it back.

```
$DSH_HOME/plugins/dsh-brand-custom/
  config.json          # { version: 1, text: { four nullable slots } }
  sidebar-mark.<ext>   # exactly one of png/jpg/webp/svg, or absent
  hero-mark.<ext>
```

Images are written through a temporary file and a rename, then any other
extension of the same kind is removed, so a status read always sees one file.
Uploads are checked against the declared content type (PNG and WebP signature
bytes; SVG is text) and capped at 4 MB.

## HTTP surface

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/brand-custom-api/config` | `{ ok, text, images }` |
| `PUT` | `/brand-custom-api/config` | merge `{ text }`, answer the new state |
| `GET`/`HEAD` | `/brand-custom-api/image/<kind>` | the stored bytes |
| `PUT` | `/brand-custom-api/image/<kind>` | replace (content-type names the format) |
| `DELETE` | `/brand-custom-api/image/<kind>` | remove |

`kind` is `sidebar-mark` or `hero-mark`. Every route is fenced to loopback
clients with a loopback `Host` header, a same-origin `Sec-Fetch-Site`, and an
`Origin` that matches the host; the images are served with `nosniff` and a
`default-src 'none'` CSP because an SVG is a document that can carry script.

## Failure containment

A plugin must not be able to take the app down with it, so both halves refuse
to let their own failures escape.

The web boot is the strict one: after the client entries settle it walks every
entry and throws `web boot: N entries did not activate …` for **any** entry that
is not `active` — a plugin whose `apply` throws leaves the whole page on its
loading screen (`bZ` in the web frontend bundle). The node half is more
forgiving: only entries on the global required list reject startup, and a normal
bundle that fails becomes `warning: N entries did not activate` with its
siblings still running.

So the browser half wraps every step whose failure is survivable in `safely()`
and logs `dsh-brand-custom: <step> unavailable — <message>` instead of throwing:
locale registration and binding, the headline observer, the initial state read,
the settings section, and each of the three slot takeovers. A host that drops
`settings.section` or already holds the locale namespace costs the reader that
one feature and nothing else.

The node half contains failures the same way: route bodies run through `guard()`
so a throw answers `500 {"ok":false,"error":"internal error"}` instead of
surfacing as an unhandled rejection, a refused route registration is logged and
skipped rather than thrown out of `apply`, and `readBody` settles on `close` as
well as `end`/`error` so a client that disconnects mid-upload cannot leave the
handler pending.

## Tests

```sh
node test/smoke.mjs        # node half: all routes, fence, signatures, storage
node test/client-smoke.mjs # browser half: registration shapes against stubs
node test/takeover.mjs     # slot takeover: occupied only while a value exists
node test/hero-text.mjs    # headline rewrite and its restore-on-clear
node test/hardening.mjs    # failure containment: broken services cost one feature
```

The browser-half tests run without a DOM or `react-dom`: they call the plugin's
components as plain functions with `useSyncExternalStore` stubbed to the live
snapshot, and build a hand-made element tree for the headline rewrite.

## Known limits

- The hero headline rewrite depends on the hero frame's structure (mark outlet
  inside the hitbox, title group beside it). If a future build changes that
  frame, the rewrite silently stops applying — the slots keep working.
- The sidebar wordmark is the host's own two-part layout re-created by hand, so
  a host restyle will not propagate to it while a label is customized.
