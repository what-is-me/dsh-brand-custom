/**
 * dsh-brand-custom — browser half.
 *
 * Three jobs, in the order the host needs them:
 *
 *  1. A Settings section (`settings.section`, id `brand-custom`) where the
 *     reader types the four labels and uploads the two marks.
 *  2. Conditional occupants for `sidebar.brand.mark`, `sidebar.brand.name` and
 *     `conversation.hero.brand.mark`. The host's own occupants register at the
 *     default priority, so this plugin registers at -1 — the lowest renders —
 *     and disposes the registration the moment the reader clears the value,
 *     which hands the slot straight back to the official brand.
 *  3. The hero headline and its preview badge, which the host renders from its
 *     own locale dictionary with no slot to occupy: rewritten on the DOM and
 *     kept rewritten by a MutationObserver, exactly as far as the reader's
 *     values reach, and handed back to the host when they are cleared.
 *
 * Everything the reader types or uploads is stored by the node half under
 * `$DSH_HOME/plugins/dsh-brand-custom/` and read back over `/brand-custom-api`.
 */
window.__ModuleLoader__.load({
  id: 'dsh-brand-custom',
  factory: require => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const react = require('react')
    const h = react.createElement

    /** Locale namespace this plugin owns (never the host's own). */
    const NAMESPACE = 'dsh-brand-custom'
    /** Route prefix the node half serves. */
    const API = '/brand-custom-api'
    /** Text slots, in settings order. */
    const TEXT_SLOTS = ['sidebarPrimary', 'sidebarBadge', 'heroTitle', 'heroBadge']
    /** Image slots, in settings order. */
    const IMAGE_KINDS = ['sidebar-mark', 'hero-mark']
    /** Upload types the node half accepts, kept in step with it. */
    const IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp,image/svg+xml'
    /** The wordmark the host paints when nothing is set; shown as the field's placeholder. */
    const DEFAULT_PRIMARY = 'deepseek'
    const DEFAULT_BADGE = 'HARNESS'

    const dictionaries = {
      zh: {
        nav: '品牌自定义',
        title: '品牌自定义',
        subtitle: '替换左上角与新建会话里的标志和文字。留空即回到 DeepSeek Harness 自己的样式。',
        sidebarGroup: '左上角（侧栏）',
        heroGroup: '新建会话页',
        markLabel: '标志图',
        markHint: 'PNG / JPEG / WebP / SVG，不超过 4 MB。上传后立即生效。',
        upload: '上传图片',
        uploading: '上传中…',
        remove: '恢复默认图形',
        sidebarPrimary: '主文字',
        sidebarPrimaryHint: '官方徽标默认写作 deepseek。',
        sidebarBadge: '徽章文字',
        sidebarBadgeHint: '官方徽标默认写作 HARNESS。',
        heroTitle: '标题文字',
        heroTitleHint: '官方文案是「探索未至之境」。',
        heroBadge: '标签文字',
        heroBadgeHint: '官方文案是「预览版」。',
        defaultHeroTitle: '探索未至之境',
        defaultHeroBadge: '预览版',
        reset: '全部恢复默认',
        resetting: '恢复中…',
        loadFailed: '读取配置失败：',
        saveFailed: '保存失败：',
        saved: '已保存',
        saving: '保存中…',
        emptyHint: '留空即为默认',
      },
      'zh-CN': {
        nav: '品牌自定义',
        title: '品牌自定义',
        subtitle: '替换左上角与新建会话里的标志和文字。留空即回到 DeepSeek Harness 自己的样式。',
        sidebarGroup: '左上角（侧栏）',
        heroGroup: '新建会话页',
        markLabel: '标志图',
        markHint: 'PNG / JPEG / WebP / SVG，不超过 4 MB。上传后立即生效。',
        upload: '上传图片',
        uploading: '上传中…',
        remove: '恢复默认图形',
        sidebarPrimary: '主文字',
        sidebarPrimaryHint: '官方徽标默认写作 deepseek。',
        sidebarBadge: '徽章文字',
        sidebarBadgeHint: '官方徽标默认写作 HARNESS。',
        heroTitle: '标题文字',
        heroTitleHint: '官方文案是「探索未至之境」。',
        heroBadge: '标签文字',
        heroBadgeHint: '官方文案是「预览版」。',
        defaultHeroTitle: '探索未至之境',
        defaultHeroBadge: '预览版',
        reset: '全部恢复默认',
        resetting: '恢复中…',
        loadFailed: '读取配置失败：',
        saveFailed: '保存失败：',
        saved: '已保存',
        saving: '保存中…',
        emptyHint: '留空即为默认',
      },
      en: {
        nav: 'Brand',
        title: 'Brand customization',
        subtitle: 'Replace the marks and labels in the sidebar and on the new-session page. Clear a field to return to the DeepSeek Harness default.',
        sidebarGroup: 'Sidebar',
        heroGroup: 'New session page',
        markLabel: 'Mark image',
        markHint: 'PNG / JPEG / WebP / SVG, up to 4 MB. Applied as soon as it uploads.',
        upload: 'Upload image',
        uploading: 'Uploading…',
        remove: 'Restore default artwork',
        sidebarPrimary: 'Primary label',
        sidebarPrimaryHint: 'The official wordmark reads "deepseek".',
        sidebarBadge: 'Badge label',
        sidebarBadgeHint: 'The official wordmark reads "HARNESS".',
        heroTitle: 'Headline',
        heroTitleHint: 'The official copy is "Into the Unknown".',
        heroBadge: 'Tag',
        heroBadgeHint: 'The official copy is "Preview".',
        defaultHeroTitle: 'Into the Unknown',
        defaultHeroBadge: 'Preview',
        reset: 'Restore all defaults',
        resetting: 'Restoring…',
        loadFailed: 'Could not read the configuration: ',
        saveFailed: 'Could not save: ',
        saved: 'Saved',
        saving: 'Saving…',
        emptyHint: 'empty uses the default',
      },
    }

    //#region store
    /** A text table with every slot unset, which means "use the host's own". */
    function emptyText() {
      const table = {}
      for (const slot of TEXT_SLOTS) table[slot] = null
      return table
    }

    /** An image table with every kind absent. */
    function emptyImages() {
      const table = {}
      for (const kind of IMAGE_KINDS) table[kind] = null
      return table
    }

    /**
     * The one store the settings page and the three slot occupants share.
     *
     * A slot occupant is rendered by the host's renderer, outside this plugin's
     * React tree, so state cannot travel down as props: it lives here and every
     * reader subscribes through `useSyncExternalStore`.
     */
    function createStore() {
      let state = {
        status: 'loading',
        error: null,
        busy: null,
        text: emptyText(),
        images: emptyImages(),
      }
      const listeners = new Set()

      const commit = next => {
        state = { ...state, ...next }
        for (const listener of [...listeners]) {
          try {
            listener()
          } catch {}
        }
      }

      /** Adopt a full answer from the node half, with every unlisted slot left unset. */
      const adopt = answer => {
        commit({
          status: 'ready',
          error: null,
          text: { ...emptyText(), ...(answer?.text ?? {}) },
          images: { ...emptyImages(), ...(answer?.images ?? {}) },
        })
      }

      /** One request against this plugin's own routes. */
      const request = async (path, init) => {
        const response = await window.fetch(API + path, {
          credentials: 'same-origin',
          cache: 'no-store',
          ...init,
        })
        let answer
        try {
          answer = await response.json()
        } catch {
          answer = undefined
        }
        if (!response.ok) throw new Error(answer?.error ?? `HTTP ${response.status}`)
        return answer
      }

      return {
        subscribe(listener) {
          listeners.add(listener)
          return () => listeners.delete(listener)
        },
        getSnapshot: () => state,
        /** Read the stored configuration once. */
        async load() {
          try {
            adopt(await request('/config'))
          } catch (error) {
            commit({ status: 'error', error: String(error?.message ?? error) })
          }
        },
        /** Store one text slot (`null` clears it). */
        async setText(slot, value) {
          commit({ busy: `text:${slot}`, error: null })
          try {
            adopt(await request('/config', {
              method: 'PUT',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ text: { [slot]: value } }),
            }))
            return true
          } catch (error) {
            commit({ error: String(error?.message ?? error) })
            return false
          } finally {
            commit({ busy: null })
          }
        },
        /** Replace one mark with the bytes of a picked file. */
        async uploadImage(kind, file) {
          commit({ busy: `image:${kind}`, error: null })
          try {
            adopt(await request(`/image/${kind}`, {
              method: 'PUT',
              headers: { 'content-type': file.type || 'application/octet-stream' },
              body: file,
            }))
            return true
          } catch (error) {
            commit({ error: String(error?.message ?? error) })
            return false
          } finally {
            commit({ busy: null })
          }
        },
        /** Drop one uploaded mark. */
        async removeImage(kind) {
          commit({ busy: `image:${kind}`, error: null })
          try {
            adopt(await request(`/image/${kind}`, { method: 'DELETE' }))
            return true
          } catch (error) {
            commit({ error: String(error?.message ?? error) })
            return false
          } finally {
            commit({ busy: null })
          }
        },
        /** Clear every text slot and every mark. */
        async resetAll() {
          commit({ busy: 'reset', error: null })
          try {
            const patch = {}
            for (const slot of TEXT_SLOTS) patch[slot] = null
            adopt(await request('/config', {
              method: 'PUT',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ text: patch }),
            }))
            for (const kind of IMAGE_KINDS) {
              if (state.images[kind] === null) continue
              adopt(await request(`/image/${kind}`, { method: 'DELETE' }))
            }
            return true
          } catch (error) {
            commit({ error: String(error?.message ?? error) })
            return false
          } finally {
            commit({ busy: null })
          }
        },
      }
    }

    /** The store every reader shares; created before any occupant can mount. */
    const store = createStore()
    //#endregion

    //#region styles
    const style = {
      page: { display: 'flex', flexDirection: 'column', gap: '18px', padding: '2px 0 8px' },
      heading: { display: 'flex', flexDirection: 'column', gap: '6px' },
      title: { margin: 0, color: 'var(--dsw-alias-label-primary)', fontSize: '16px', fontWeight: 500, lineHeight: '24px' },
      subtitle: { margin: 0, color: 'var(--dsw-alias-label-tertiary)', fontSize: '12px', lineHeight: '18px' },
      card: {
        display: 'flex',
        flexDirection: 'column',
        gap: '14px',
        border: '1px solid var(--dsw-alias-interactive-bg-hover)',
        borderRadius: 'var(--dsw-radius-md)',
        padding: '14px 16px 16px',
      },
      cardTitle: { margin: 0, color: 'var(--dsw-alias-label-primary)', fontSize: '13px', fontWeight: 600, lineHeight: '20px' },
      row: { display: 'flex', flexDirection: 'column', gap: '6px' },
      rowHead: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '8px' },
      label: { color: 'var(--dsw-alias-label-primary)', fontSize: '13px', lineHeight: '20px' },
      hint: { color: 'var(--dsw-alias-label-tertiary)', fontSize: '11px', lineHeight: '16px' },
      input: {
        boxSizing: 'border-box',
        width: '100%',
        color: 'var(--dsw-alias-label-primary)',
        background: 'var(--dsw-alias-interactive-bg-hover)',
        border: '0.5px solid var(--dsw-alias-interactive-bg-hover)',
        borderRadius: 'var(--dsw-radius-sm)',
        padding: '6px 10px',
        fontFamily: 'inherit',
        fontSize: '13px',
        lineHeight: '20px',
        outline: 'none',
      },
      markRow: { display: 'flex', alignItems: 'center', gap: '12px' },
      well: {
        flex: 'none',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '48px',
        height: '48px',
        border: '1px dashed var(--dsw-alias-interactive-bg-hover)',
        borderRadius: 'var(--dsw-radius-sm)',
        background: 'var(--dsw-alias-interactive-bg-hover)',
        overflow: 'hidden',
      },
      wellImage: { maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' },
      markCopy: { display: 'flex', flexDirection: 'column', gap: '4px', minWidth: 0 },
      actions: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' },
      button: {
        boxSizing: 'border-box',
        cursor: 'pointer',
        color: 'var(--dsw-alias-label-primary)',
        background: 'var(--dsw-alias-interactive-bg-hover)',
        border: '0.5px solid var(--dsw-alias-interactive-bg-hover)',
        borderRadius: 'var(--dsw-radius-sm)',
        padding: '5px 12px',
        fontFamily: 'inherit',
        fontSize: '12px',
        lineHeight: '18px',
      },
      buttonQuiet: { color: 'var(--dsw-alias-label-tertiary)' },
      statusLine: { minHeight: '16px', color: 'var(--dsw-alias-label-tertiary)', fontSize: '11px', lineHeight: '16px' },
      errorLine: { minHeight: '16px', color: 'var(--dsw-alias-state-error-primary)', fontSize: '11px', lineHeight: '16px' },
      badge: {
        flex: 'none',
        padding: '1px 6px 0',
        borderRadius: '4px',
        background: 'var(--dsw-alias-label-primary)',
        color: 'var(--dsw-alias-label-primary-inverted)',
        fontFamily: 'var(--ds-font-family-code)',
        fontSize: '11px',
        fontWeight: 700,
        letterSpacing: '0.06em',
        lineHeight: '16px',
        whiteSpace: 'nowrap',
      },
      mark: { display: 'block', objectFit: 'contain' },
      brandName: { display: 'inline-flex', alignItems: 'center', gap: '6px', minWidth: 0, height: '24px' },
      brandPrimary: {
        color: 'var(--dsw-alias-label-primary)',
        fontSize: '18px',
        fontWeight: 600,
        letterSpacing: '0.04em',
        lineHeight: '24px',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      },
    }
    //#endregion

    /** The URL of one stored mark, versioned so a replacement is never served from cache. */
    function imageUrl(kind, state) {
      if (state === null || state === undefined) return null
      return `${API}/image/${kind}?v=${encodeURIComponent(state.version)}`
    }

    /** Subscribe to the shared store from a function component. */
    function useBrandState() {
      return react.useSyncExternalStore(store.subscribe, store.getSnapshot)
    }

    //#region hero label rewriting
    /**
     * The hero frame, read from the mark slot's own outlet so no hashed class
     * name is ever written down here: the outlet's parent is the hitbox, its
     * parent is the headline, and the headline holds the hitbox and the title
     * group side by side.
     * @returns the headline's label span and tag span, or null when the hero is not mounted.
     */
    function heroTitleSpans() {
      const outlet = document.querySelector('[data-slot="conversation.hero.brand.mark"]')
      const headline = outlet?.parentElement?.parentElement
      if (headline === undefined || headline === null) return null
      // The title group is whichever child does not hold the mark; the label is
      // its first child and the tag its second, and a missing tag is survivable.
      for (const group of headline.children) {
        if (group.contains(outlet)) continue
        const label = group.children[0]
        if (label === undefined) continue
        return { label, tag: group.children[1] ?? null }
      }
      return null
    }

    /**
     * Write one value into one span, remembering what the host itself put there.
     *
     * The host re-renders the span whenever the language changes or the hero
     * remounts; text it wrote that this plugin did not write becomes the new
     * "host's own" value, so clearing a field restores the current language and
     * not the one that happened to be active at first load.
     */
    const spanMemory = new WeakMap()

    function paint(span, value) {
      if (span === null || span === undefined) return
      const record = spanMemory.get(span) ?? { host: span.textContent, written: null }
      const current = span.textContent
      if (record.written !== null && current !== record.written && current !== record.host) {
        record.host = current
      }
      const next = value === null ? record.host : value
      if (current !== next) span.textContent = next
      record.written = next
      spanMemory.set(span, record)
    }

    /**
     * Keep the hero's own copy on the reader's values for as long as any hero
     * field is set, and stop watching the document entirely when none is.
     * @returns disposer.
     */
    function watchHeroText() {
      let observer
      let frame

      const sync = () => {
        const state = store.getSnapshot()
        const spans = heroTitleSpans()
        // Painting every time is what makes a cleared field hand the host's own
        // copy back: `paint` writes the remembered host text for a null value.
        if (spans !== null) {
          paint(spans.label, state.text.heroTitle)
          paint(spans.tag, state.text.heroBadge)
        }
        if (state.text.heroTitle !== null || state.text.heroBadge !== null) return
        // Nothing is customized any more: the host's text is back in place and
        // further document mutations are not this plugin's business.
        observer?.disconnect()
        observer = undefined
      }

      const schedule = () => {
        if (frame !== undefined) return
        frame = window.requestAnimationFrame(() => {
          frame = undefined
          try {
            sync()
          } catch {}
        })
      }

      // The observer watches text nodes only: a streamed answer rewrites message
      // text constantly, and characterData on those nodes is not a hero change.
      const ensureObserver = () => {
        if (observer !== undefined) return
        const state = store.getSnapshot()
        if (state.text.heroTitle === null && state.text.heroBadge === null) return
        observer = new window.MutationObserver(schedule)
        observer.observe(document.body, { childList: true, subtree: true, characterData: true })
      }

      const onChange = () => {
        ensureObserver()
        schedule()
      }

      const unsubscribe = store.subscribe(onChange)
      onChange()

      return () => {
        unsubscribe()
        if (frame !== undefined) window.cancelAnimationFrame(frame)
        observer?.disconnect()
        observer = undefined
        // Hand every span back the copy the host last wrote.
        const spans = heroTitleSpans()
        for (const span of spans === null ? [] : [spans.label, spans.tag]) {
          if (span === null) continue
          const record = spanMemory.get(span)
          if (record === undefined || record.written === null) continue
          if (span.textContent !== record.host) span.textContent = record.host
          record.written = null
        }
      }
    }

    //#endregion

    //#region slot occupants
    /** The sidebar mark, sized by the host's own `size` prop. */
    function SidebarMark({ size = 24 }) {
      const state = useBrandState()
      const url = imageUrl('sidebar-mark', state.images['sidebar-mark'])
      if (url === null) return null
      return h('img', {
        src: url,
        alt: '',
        width: size,
        height: size,
        style: { ...style.mark, width: `${size}px`, height: `${size}px` },
        'aria-hidden': 'true',
      })
    }

    /** The sidebar wordmark: the reader's two labels, each falling back to the official wording. */
    function SidebarName() {
      const state = useBrandState()
      const primary = state.text.sidebarPrimary ?? DEFAULT_PRIMARY
      const badge = state.text.sidebarBadge ?? DEFAULT_BADGE
      return h('span', { style: style.brandName },
        h('span', { style: style.brandPrimary }, primary),
        h('span', { style: style.badge }, badge),
      )
    }

    /** The new-session mark, sized by the host's own `size` prop (34px at the current layout). */
    function HeroMark({ size = 34, className }) {
      const state = useBrandState()
      const url = imageUrl('hero-mark', state.images['hero-mark'])
      if (url === null) return null
      return h('img', {
        src: url,
        className,
        alt: '',
        width: size,
        height: size,
        style: { ...style.mark, width: `${size}px`, height: `${size}px` },
        'aria-hidden': 'true',
      })
    }

    /**
     * Hold a brand slot exactly while the reader has something to put in it.
     *
     * This plugin registers at priority -1, below the host's own occupants, so
     * the registration shadows them for as long as it lives; disposing it puts
     * the official brand back with no further work.
     */
    function takeover(ctx, slot, component, wanted) {
      return ctx.slots.inject(slot, () => {
        let dispose
        const sync = () => {
          const wants = wanted(store.getSnapshot())
          if (wants && dispose === undefined) {
            try {
              dispose = ctx.slots.register({ name: slot, priority: -1 }, component)
            } catch (error) {
              // Another plugin already holds this slot below the official
              // occupant: leave it to them rather than crash the plugin.
              console.warn(`dsh-brand-custom: could not take "${slot}" — ${String(error?.message ?? error)}`)
              dispose = () => {}
            }
          } else if (!wants && dispose !== undefined) {
            dispose()
            dispose = undefined
          }
        }
        const unsubscribe = store.subscribe(sync)
        sync()
        return () => {
          unsubscribe()
          if (dispose === undefined) return
          dispose()
          dispose = undefined
        }
      })
    }
    //#endregion

    //#region settings page
    /**
     * The settings section.
     * @param props.t - this plugin's locale reader.
     * @param props.store - the shared store.
     */
    function BrandSection({ t, store: shared }) {
      const state = react.useSyncExternalStore(shared.subscribe, shared.getSnapshot)
      /** The field being typed into, and its characters: everything else shows the stored value. */
      const [editing, setEditing] = react.useState(null)
      const [draft, setDraft] = react.useState('')
      const [savedAt, setSavedAt] = react.useState(0)

      const commit = async slot => {
        const trimmed = draft.trim()
        const stored = trimmed === '' ? null : trimmed
        // The field keeps the reader's characters until the store answers, so a
        // refusal leaves their text on screen with the error beside it.
        if (stored === state.text[slot]) {
          setEditing(null)
          return
        }
        const ok = await shared.setText(slot, stored)
        if (ok) {
          setEditing(null)
          setSavedAt(Date.now())
        }
      }

      const field = (slot, label, hint, placeholder) => h('div', { style: style.row, key: slot },
        h('div', { style: style.rowHead },
          h('label', { style: style.label, htmlFor: `brand-custom-${slot}` }, label),
          h('span', { style: style.hint }, t('emptyHint')),
        ),
        h('input', {
          id: `brand-custom-${slot}`,
          style: style.input,
          type: 'text',
          value: editing === slot ? draft : state.text[slot] ?? '',
          placeholder,
          onFocus: event => {
            setEditing(slot)
            setDraft(event.target.value)
          },
          onChange: event => {
            setDraft(event.target.value)
          },
          onBlur: () => {
            if (editing === slot) void commit(slot)
          },
          onKeyDown: event => {
            if (event.key !== 'Enter') return
            event.preventDefault()
            void commit(slot)
          },
        }),
        h('span', { style: style.hint }, hint),
      )

      const markRow = (kind, label, hint) => {
        const stored = state.images[kind]
        const url = imageUrl(kind, stored)
        const busy = state.busy === `image:${kind}`
        const inputId = `brand-custom-file-${kind}`
        return h('div', { style: style.row, key: kind },
          h('span', { style: style.label }, label),
          h('div', { style: style.markRow },
            h('span', { style: style.well }, url === null ? null : h('img', { src: url, alt: '', style: style.wellImage })),
            h('div', { style: style.markCopy },
              h('div', { style: style.actions },
                h('button', {
                  type: 'button',
                  style: style.button,
                  disabled: busy,
                  onClick: () => document.getElementById(inputId)?.click(),
                }, busy ? t('uploading') : t('upload')),
                h('button', {
                  type: 'button',
                  style: { ...style.button, ...style.buttonQuiet },
                  disabled: busy || url === null,
                  onClick: () => {
                    void shared.removeImage(kind).then(ok => {
                      if (ok) setSavedAt(Date.now())
                    })
                  },
                }, t('remove')),
              ),
              h('span', { style: style.hint }, hint),
            ),
          ),
          h('input', {
            id: inputId,
            type: 'file',
            accept: IMAGE_ACCEPT,
            style: { display: 'none' },
            onChange: event => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (file === undefined) return
              void shared.uploadImage(kind, file).then(ok => {
                if (ok) setSavedAt(Date.now())
              })
            },
          }),
        )
      }

      const busyReset = state.busy === 'reset'

      return h('div', { style: style.page, 'data-brand-custom-settings': '' },
        h('div', { style: style.heading },
          h('h3', { style: style.title }, t('title')),
          h('p', { style: style.subtitle }, t('subtitle')),
        ),

        h('div', { style: style.card, 'data-brand-custom-group': 'sidebar' },
          h('h4', { style: style.cardTitle }, t('sidebarGroup')),
          markRow('sidebar-mark', t('markLabel'), t('markHint')),
          field('sidebarPrimary', t('sidebarPrimary'), t('sidebarPrimaryHint'), DEFAULT_PRIMARY),
          field('sidebarBadge', t('sidebarBadge'), t('sidebarBadgeHint'), DEFAULT_BADGE),
        ),

        h('div', { style: style.card, 'data-brand-custom-group': 'hero' },
          h('h4', { style: style.cardTitle }, t('heroGroup')),
          markRow('hero-mark', t('markLabel'), t('markHint')),
          field('heroTitle', t('heroTitle'), t('heroTitleHint'), t('defaultHeroTitle')),
          field('heroBadge', t('heroBadge'), t('heroBadgeHint'), t('defaultHeroBadge')),
        ),

        h('div', { style: style.actions },
          h('button', {
            type: 'button',
            style: { ...style.button, ...style.buttonQuiet },
            disabled: busyReset,
            onClick: () => {
              void shared.resetAll().then(ok => {
                if (ok) setSavedAt(Date.now())
              })
            },
          }, busyReset ? t('resetting') : t('reset')),
          h('span', { style: style.statusLine },
            state.busy !== null ? t('saving') : savedAt > 0 ? t('saved') : '',
          ),
        ),

        h('span', { style: style.errorLine },
          state.error === null ? '' : `${t('loadFailed')}${state.error}`,
        ),
      )
    }
    //#endregion

    const inject = ['slots', 'locale']

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NAMESPACE, dictionaries), 'dsh-brand-custom: locale')
      const t = ctx.locale.bind(NAMESPACE)

      // The observer's own disposer puts the host's copy back.
      ctx.effect(() => watchHeroText(), 'dsh-brand-custom: hero labels')

      // Read once; every occupant and the page follow the same state from here.
      void store.load()

      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'brand-custom',
        order: 60,
        label: () => t('nav'),
        locale: NAMESPACE,
        inject: () => ({ t, store }),
      }, BrandSection))

      ctx.effect(
        () => takeover(ctx, 'sidebar.brand.mark', SidebarMark, state => state.images['sidebar-mark'] !== null),
        'dsh-brand-custom: sidebar mark',
      )
      ctx.effect(
        () => takeover(ctx, 'sidebar.brand.name', SidebarName, state => state.text.sidebarPrimary !== null || state.text.sidebarBadge !== null),
        'dsh-brand-custom: sidebar name',
      )
      ctx.effect(
        () => takeover(ctx, 'conversation.hero.brand.mark', HeroMark, state => state.images['hero-mark'] !== null),
        'dsh-brand-custom: hero mark',
      )
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
