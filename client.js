/**
 * Browser half of dsh-tool-audit.
 *
 * Two surfaces with separate jobs:
 * - the sidebar **Audit** page shows what the audit found, what waits for
 *   review, and the recent decision stream;
 * - the bundle's page in **Plugins** carries the settings and the provider
 *   check.
 *
 * All data comes from the Host routes `/dsh-tool-audit/state` and
 * `/dsh-tool-audit/action`; the page never derives audit facts itself.
 */

window.__ModuleLoader__.load({
  id: 'dsh-tool-audit',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /** Locale namespace of this plugin's browser dictionary. */
    const NS = 'dshToolAudit'
    /** Panel id shared by the sidebar row and the `main` panel. */
    const PANEL_ID = 'dsh-tool-audit'
    /** Host route prefix registered by this bundle's Host half. */
    const API = '/dsh-tool-audit'

    const dictionaries = {
      en: {
        panel: 'Audit',
        title: 'Tool audit',
        subtitle: 'Records every tool call, pins binary hashes to reviewed releases, and gates commands the rules do not cover.',
        pending: 'Waiting for review',
        pendingRules: 'Rule proposals',
        pendingBinaries: 'Unverified binaries',
        pendingDiffs: 'Updated binaries',
        rules: 'Rules',
        noRules: 'No rules yet. Repeating the same command proposes one.',
        approve: 'Approve',
        reject: 'Reject',
        binaries: 'Binaries',
        noBinaries: 'No binaries seen yet.',
        trust: 'Pin',
        forget: 'Forget',
        releases: 'Pinned releases',
        noReleases: 'No release pinned yet.',
        addRelease: 'Pin a release',
        name: 'Name',
        installedPath: 'Installed path',
        repo: 'Repository',
        tag: 'Tag',
        commit: 'Commit',
        assetHash: 'Release SHA-256',
        save: 'Save',
        remove: 'Remove',
        diffs: 'Binary updates',
        noDiffs: 'No binary changed since its release was pinned.',
        from: 'From',
        to: 'To',
        confirm: 'Accept new hash',
        dismiss: 'Dismiss',
        newCommit: 'New commit (optional)',
        diffHint: 'Run this to see what changed, then accept the new hash:',
        recent: 'Recent decisions',
        empty: 'No audit lines yet.',
        loading: 'Loading…',
        failed: 'The audit Host route is unavailable.',
        failedHint: 'Open this page from the Web GUI with the bundle enabled.',
        retry: 'Retry',
        settings: 'Audit settings',
        settingsHint: 'Saved on the Host and applied to the next tool call.',
        mode: 'Mode',
        modeObserve: 'Observe',
        modeAsk: 'Ask',
        modeEnforce: 'Enforce',
        onApprovalNever: 'Gate ask under policy never',
        neverDeny: 'Defer to approval (rejected)',
        neverObserve: 'Record and allow',
        provider: 'Decision provider',
        providerOff: 'Off',
        providerJev: 'Jev (TypeSafe System One)',
        providerGemini: 'Gemini Decision 1',
        endpoint: 'Endpoint',
        model: 'Model',
        apiKey: 'API key',
        apiKeyPlaceholder: 'Paste the key; it is stored in the credential store',
        saveKey: 'Save key',
        clearKey: 'Remove key',
        timeout: 'Timeout (ms)',
        lowConfidence: 'Low confidence threshold',
        dataEgress: 'Deny above data egress',
        inScope: 'Deny below in-scope',
        destructive: 'Ask above destructive',
        external: 'Ask above external effect',
        analyzeBinaries: 'Resolve and hash binaries',
        proposeRules: 'Propose rules from repeated commands',
        minRuns: 'Runs before a proposal',
        auditMaxLines: 'Audit lines retained',
        test: 'Check provider',
        testing: 'Checking…',
        testOk: 'Provider answered.',
        testFailed: 'Provider check failed',
        saved: 'Saved.',
        saveFailed: 'Could not save.',
        failedAction: 'Action failed',
        none: '—',
        keySet: 'key set',
        keyMissing: 'key missing',
      },
      ja: {
        panel: '監査',
        title: 'ツール監査',
        subtitle: 'ツール呼び出しを記録し、バイナリのハッシュを確認済みリリースに固定し、ルール外のコマンドをゲートに通します。',
        pending: '確認待ち',
        pendingRules: 'ルール候補',
        pendingBinaries: '未検証のバイナリ',
        pendingDiffs: '更新されたバイナリ',
        rules: 'ルール',
        noRules: 'まだルールはありません。同じコマンドを繰り返すと候補になります。',
        approve: '承認',
        reject: '却下',
        binaries: 'バイナリ',
        noBinaries: 'まだバイナリを観測していません。',
        trust: '固定',
        forget: '削除',
        releases: '固定したリリース',
        noReleases: 'まだリリースを固定していません。',
        addRelease: 'リリースを固定',
        name: '名前',
        installedPath: 'インストール先',
        repo: 'リポジトリ',
        tag: 'タグ',
        commit: 'コミット',
        assetHash: 'リリースの SHA-256',
        save: '保存',
        remove: '削除',
        diffs: 'バイナリの更新',
        noDiffs: '固定したリリースからバイナリは変わっていません。',
        from: '変更前',
        to: '変更後',
        confirm: '新しいハッシュを承認',
        dismiss: '却下',
        newCommit: '新しいコミット（任意）',
        diffHint: '差分を確認してから新しいハッシュを承認してください:',
        recent: '最近の判定',
        empty: '監査ログはまだありません。',
        loading: '読み込み中…',
        failed: '監査の Host ルートに到達できません。',
        failedHint: 'バンドルを有効にした状態で Web GUI から開いてください。',
        retry: '再試行',
        settings: '監査の設定',
        settingsHint: 'Host に保存され、次のツール呼び出しから反映されます。',
        mode: 'モード',
        modeObserve: '観測のみ',
        modeAsk: '確認する',
        modeEnforce: '強制する',
        onApprovalNever: '承認ポリシー never での ask',
        neverDeny: '承認に委ねる（拒否）',
        neverObserve: '記録して許可',
        provider: '判定プロバイダ',
        providerOff: '使わない',
        providerJev: 'Jev (TypeSafe System One)',
        providerGemini: 'Gemini Decision 1',
        endpoint: 'エンドポイント',
        model: 'モデル',
        apiKey: 'API キー',
        apiKeyPlaceholder: 'キーを貼り付け（資格情報ストアに保存されます）',
        saveKey: 'キーを保存',
        clearKey: 'キーを削除',
        timeout: 'タイムアウト (ms)',
        lowConfidence: '低確信のしきい値',
        dataEgress: '外部送信で拒否する確率',
        inScope: '指示範囲外で拒否する確率',
        destructive: '破壊的で確認する確率',
        external: '外部影響で確認する確率',
        analyzeBinaries: 'バイナリを解決してハッシュを取る',
        proposeRules: '繰り返されたコマンドからルールを提案する',
        minRuns: '提案までの実行回数',
        auditMaxLines: '保持する監査行数',
        test: 'プロバイダを確認',
        testing: '確認中…',
        testOk: 'プロバイダが応答しました。',
        testFailed: 'プロバイダの確認に失敗しました',
        saved: '保存しました。',
        saveFailed: '保存できませんでした。',
        failedAction: '操作に失敗しました',
        none: '—',
        keySet: 'キー設定済み',
        keyMissing: 'キー未設定',
      },
    }

    /**
     * Call one audit Host route.
     * @param {string} path - route suffix.
     * @param {object} [init] - fetch options.
     * @returns {Promise<object>} parsed JSON.
     */
    async function call(path, init) {
      const response = await fetch(`${API}${path}`, {
        ...init,
        headers: {
          'x-dsh-tool-audit': '1',
          ...(init?.body === undefined ? {} : { 'content-type': 'application/json' }),
          ...(init?.headers ?? {}),
        },
      })
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
      return response.json()
    }

    /**
     * Subscribe to the audit snapshot for one mounted component.
     * @returns {{ state: object, reload: () => Promise<void>, act: (action: string, payload?: object) => Promise<object> }}
     */
    function useAudit() {
      const [state, setState] = React.useState({ status: 'loading', value: null, error: null })
      const alive = React.useRef(true)
      const load = React.useCallback(async () => {
        try {
          const value = await call('/state')
          if (alive.current) setState({ status: 'ready', value, error: null })
        } catch (error) {
          if (alive.current) setState(previous => ({ ...previous, status: previous.value === null ? 'failed' : 'stale', error }))
        }
      }, [])
      const act = React.useCallback(async (action, payload) => {
        const value = await call('/action', { method: 'POST', body: JSON.stringify({ action, payload }) })
        if (alive.current) setState({ status: 'ready', value, error: null })
        return value
      }, [])
      React.useEffect(() => {
        alive.current = true
        void load()
        const timer = setInterval(() => { void load() }, 15000)
        return () => { alive.current = false; clearInterval(timer) }
      }, [load])
      return { state, reload: load, act }
    }

    const styles = {
      page: { padding: '24px 28px', maxWidth: 1000, color: 'var(--dsw-alias-text-primary, #e8e8e8)' },
      title: { fontSize: 20, fontWeight: 600, margin: 0 },
      subtitle: { margin: '6px 0 20px', opacity: 0.7, fontSize: 13 },
      section: { marginTop: 28 },
      sectionTitle: { fontSize: 13, fontWeight: 600, letterSpacing: '0.02em', opacity: 0.75, margin: '0 0 8px' },
      row: { display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0', borderBottom: '1px solid var(--dsw-alias-border-subtle, #2a2a2a)' },
      mono: { fontFamily: 'var(--dsw-font-family-mono, ui-monospace, monospace)', fontSize: 12 },
      muted: { opacity: 0.6, fontSize: 12 },
      button: { fontSize: 12, padding: '4px 10px', borderRadius: 6, border: '1px solid var(--dsw-alias-border-subtle, #3a3a3a)', background: 'transparent', color: 'inherit', cursor: 'pointer' },
      primary: { fontSize: 12, padding: '6px 14px', borderRadius: 6, border: '1px solid var(--dsw-alias-accent, #4c8dff)', background: 'var(--dsw-alias-accent, #4c8dff)', color: '#fff', cursor: 'pointer' },
      field: { display: 'grid', gridTemplateColumns: '240px 1fr', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: '1px solid var(--dsw-alias-border-subtle, #2a2a2a)' },
      input: { fontSize: 13, padding: '5px 8px', borderRadius: 6, border: '1px solid var(--dsw-alias-border-subtle, #3a3a3a)', background: 'var(--dsw-alias-bg-subtle, #161616)', color: 'inherit' },
      error: { padding: 14, borderRadius: 8, border: '1px solid var(--dsw-alias-border-subtle, #3a3a3a)', marginTop: 20 },
      form: { display: 'grid', gridTemplateColumns: '180px 1fr', gap: 8, marginTop: 10 },
    }

    /**
     * Resolve visible text through the locale service when the slot passes `t`.
     * @param {object} props - slot props.
     * @returns {(key: string) => string} text lookup.
     */
    function translate(props) {
      if (typeof props?.t === 'function') return key => props.t(key)
      return key => dictionaries.en[key] ?? key
    }

    /** Render the sidebar glyph; a filled dot means something waits for review. */
    function AuditIcon({ size }) {
      const { state } = useAudit()
      const pending = (state.value?.pendingTotal ?? 0) > 0
      const edge = typeof size === 'number' ? size : 16
      return h('svg', { width: edge, height: edge, viewBox: '0 0 16 16', 'aria-hidden': true },
        h('path', { d: 'M3 2.5h10v11H3z', fill: 'none', stroke: 'currentColor', strokeWidth: 1.3, strokeLinejoin: 'round' }),
        h('path', { d: 'M5.4 6h5.2M5.4 8.4h5.2M5.4 10.8h3.2', stroke: 'currentColor', strokeWidth: 1.1, strokeLinecap: 'round' }),
        pending ? h('circle', { cx: 12.6, cy: 3.4, r: 2.4, fill: 'var(--dsw-alias-accent, #4c8dff)' }) : null)
    }

    /** Render the audit page: pending work first, then the durable facts. */
    function AuditPage(props) {
      const { state, act, reload } = useAudit()
      const [busy, setBusy] = React.useState(null)
      const [notice, setNotice] = React.useState(null)
      const label = translate(props)
      const [draft, setDraft] = React.useState({ name: '', installedPath: '', repo: '', tag: '', commit: '', assetSha256: '' })
      const [commits, setCommits] = React.useState({})

      async function run(action, payload) {
        setBusy(action)
        setNotice(null)
        try {
          await act(action, payload)
        } catch (error) {
          setNotice(`${label('failedAction')}: ${error.message}`)
        } finally {
          setBusy(null)
        }
      }

      if (state.status === 'loading') return h('div', { style: styles.page }, h('p', { style: styles.muted }, label('loading')))
      if (state.status === 'failed' && state.value === null) {
        return h('div', { style: styles.page },
          h('h1', { style: styles.title }, label('title')),
          h('div', { style: styles.error },
            h('p', { style: { margin: 0 } }, label('failed')),
            h('p', { style: { ...styles.muted, marginBottom: 12 } }, label('failedHint')),
            h('button', { style: styles.primary, onClick: () => { void reload() } }, label('retry'))))
      }

      const data = state.value ?? {}
      const pending = data.pending ?? { rules: 0, binaries: 0, diffs: 0 }
      const rules = data.rules ?? []
      const binaries = data.binaries ?? []
      const packages = data.packages ?? []
      const diffs = (data.diffs ?? []).filter(diff => diff.status === 'pending')
      const recent = (data.recent ?? []).slice().reverse().slice(0, 60)
      const setDraftField = (field, value) => setDraft({ ...draft, [field]: value })

      return h('div', { style: styles.page },
        h('h1', { style: styles.title }, label('title')),
        h('p', { style: styles.subtitle }, label('subtitle')),
        notice === null ? null : h('p', { style: styles.muted }, notice),

        h('section', { style: styles.section },
          h('h2', { style: styles.sectionTitle }, label('pending')),
          h('div', { style: styles.row }, h('span', null, label('pendingRules')), h('span', { style: styles.muted }, String(pending.rules))),
          h('div', { style: styles.row }, h('span', null, label('pendingBinaries')), h('span', { style: styles.muted }, String(pending.binaries))),
          h('div', { style: styles.row }, h('span', null, label('pendingDiffs')), h('span', { style: styles.muted }, String(pending.diffs)))),

        h('section', { style: styles.section },
          h('h2', { style: styles.sectionTitle }, label('diffs')),
          diffs.length === 0 ? h('p', { style: styles.muted }, label('noDiffs')) : null,
          diffs.map(diff => {
            return h('div', { key: diff.id, style: styles.row },
              h('span', { style: { ...styles.mono, flex: 1 } },
                diff.path,
                h('br'),
                h('span', { style: styles.muted },
                  `${(diff.fromSha256 ?? '').slice(0, 12)} → ${(diff.toSha256 ?? '').slice(0, 12)} · `,
                  `${diff.fromCommit ?? '?'}..${commits[diff.id] ?? diff.toCommit ?? '?'}`)),
              h('input', {
                style: { ...styles.input, width: 160 },
                placeholder: label('newCommit'),
                value: commits[diff.id] ?? '',
                onChange: event => setCommits({ ...commits, [diff.id]: event.target.value }),
              }),
              h('button', {
                style: styles.primary,
                disabled: busy !== null,
                onClick: () => { void run('confirm-diff', { id: diff.id, toCommit: commits[diff.id] ?? '' }) },
              }, label('confirm')),
              h('button', {
                style: styles.button,
                disabled: busy !== null,
                onClick: () => { void run('dismiss-diff', { id: diff.id }) },
              }, label('dismiss')))
          })),

        h('section', { style: styles.section },
          h('h2', { style: styles.sectionTitle }, label('rules')),
          rules.length === 0 ? h('p', { style: styles.muted }, label('noRules')) : null,
          rules.map(rule => h('div', { key: rule.id, style: styles.row },
            h('span', { style: { ...styles.mono, flex: 1 } }, Array.isArray(rule.tokens) ? rule.tokens.join(' ') : ''),
            h('span', { style: styles.muted }, `${rule.status} · ${(rule.binarySha256 ?? '').slice(0, 10)}`),
            rule.status === 'proposed'
              ? h('span', null,
                h('button', { style: styles.primary, disabled: busy !== null, onClick: () => { void run('approve-rule', { id: rule.id }) } }, label('approve')),
                ' ',
                h('button', { style: styles.button, disabled: busy !== null, onClick: () => { void run('reject-rule', { id: rule.id }) } }, label('reject')))
              : null))),

        h('section', { style: styles.section },
          h('h2', { style: styles.sectionTitle }, label('binaries')),
          binaries.length === 0 ? h('p', { style: styles.muted }, label('noBinaries')) : null,
          binaries.map(binary => h('div', { key: binary.sha256, style: styles.row },
            h('span', { style: { ...styles.mono, flex: 1 } }, binary.path ?? label('none')),
            h('span', { style: styles.muted }, `${binary.trust} · ${(binary.sha256 ?? '').slice(0, 12)}`),
            binary.trust === 'unknown'
              ? h('button', { style: styles.primary, disabled: busy !== null, onClick: () => { void run('trust-binary', { sha256: binary.sha256 }) } }, label('trust'))
              : h('button', { style: styles.button, disabled: busy !== null, onClick: () => { void run('forget-binary', { sha256: binary.sha256 }) } }, label('forget'))))),

        h('section', { style: styles.section },
          h('h2', { style: styles.sectionTitle }, label('releases')),
          packages.length === 0 ? h('p', { style: styles.muted }, label('noReleases')) : null,
          packages.map(pin => h('div', { key: pin.id, style: styles.row },
            h('span', { style: { ...styles.mono, flex: 1 } },
              `${pin.name} ${pin.tag ?? ''}`,
              h('br'),
              h('span', { style: styles.muted }, `${pin.installedPath} · ${(pin.assetSha256 ?? '').slice(0, 12)} · ${pin.commit ?? '?'}`)),
            h('button', { style: styles.button, disabled: busy !== null, onClick: () => { void run('remove-release', { id: pin.id }) } }, label('remove')))),
          h('div', { style: styles.form },
            h('input', { style: styles.input, placeholder: label('name'), value: draft.name, onChange: event => setDraftField('name', event.target.value) }),
            h('input', { style: styles.input, placeholder: label('installedPath'), value: draft.installedPath, onChange: event => setDraftField('installedPath', event.target.value) }),
            h('input', { style: styles.input, placeholder: label('repo'), value: draft.repo, onChange: event => setDraftField('repo', event.target.value) }),
            h('input', { style: styles.input, placeholder: label('tag'), value: draft.tag, onChange: event => setDraftField('tag', event.target.value) }),
            h('input', { style: styles.input, placeholder: label('commit'), value: draft.commit, onChange: event => setDraftField('commit', event.target.value) }),
            h('input', { style: styles.input, placeholder: label('assetHash'), value: draft.assetSha256, onChange: event => setDraftField('assetSha256', event.target.value) })),
          h('div', { style: { marginTop: 10 } },
            h('button', {
              style: styles.primary,
              disabled: busy !== null,
              onClick: () => {
                void run('record-release', draft).then(() => setDraft({ name: '', installedPath: '', repo: '', tag: '', commit: '', assetSha256: '' }))
              },
            }, label('addRelease')))),

        h('section', { style: styles.section },
          h('h2', { style: styles.sectionTitle }, label('recent')),
          recent.length === 0 ? h('p', { style: styles.muted }, label('empty')) : null,
          recent.map((line, index) => h('div', { key: `${line.callId ?? index}-${index}`, style: styles.row },
            h('span', { style: styles.muted }, String(line.ts ?? '').slice(11, 19)),
            h('span', { style: { width: 80 } }, line.tool ?? ''),
            h('span', { style: { ...styles.mono, flex: 1 } }, (line.command ?? label('none')).slice(0, 90)),
            h('span', { style: styles.muted }, `${line.decision ?? ''}${line.source === undefined ? '' : ` (${line.source})`}`)))))
    }

    /** Render the settings page shown on the bundle's page in Plugins. */
    function AuditSettings(props) {
      const { state, act, reload } = useAudit()
      const [draft, setDraft] = React.useState(null)
      const [keyDraft, setKeyDraft] = React.useState('')
      const [notice, setNotice] = React.useState(null)
      const [testing, setTesting] = React.useState(false)
      const label = translate(props)
      const config = state.value?.config
      const key = state.value?.key ?? { configured: false, writable: false }

      React.useEffect(() => {
        if (config !== undefined && draft === null) setDraft({ ...config })
      }, [config, draft])

      if (state.status === 'loading') return h('p', { style: styles.muted }, label('loading'))
      if (state.status === 'failed' && state.value === null) {
        return h('div', null,
          h('p', null, label('failed')),
          h('p', { style: styles.muted }, label('failedHint')),
          h('button', { style: styles.primary, onClick: () => { void reload() } }, label('retry')))
      }
      if (draft === null) return null

      const update = (field, value) => setDraft({ ...draft, [field]: value })
      const numberField = (field, step) => h('input', {
        type: 'number',
        step,
        style: styles.input,
        value: draft[field],
        onChange: event => update(field, Number(event.target.value)),
      })
      const textField = field => h('input', {
        style: styles.input,
        value: draft[field] ?? '',
        onChange: event => update(field, event.target.value),
      })
      const checkbox = field => h('input', {
        type: 'checkbox',
        checked: draft[field] === true,
        onChange: event => update(field, event.target.checked),
      })

      async function save() {
        try {
          await act('set-settings', draft)
          setNotice({ kind: 'ok', text: label('saved') })
        } catch (error) {
          setNotice({ kind: 'error', text: `${label('saveFailed')} ${error.message}` })
        }
      }

      async function saveKey() {
        try {
          await act('set-api-key', { value: keyDraft })
          setKeyDraft('')
          setNotice({ kind: 'ok', text: label('saved') })
        } catch (error) {
          setNotice({ kind: 'error', text: `${label('saveFailed')} ${error.message}` })
        }
      }

      async function clearKey() {
        try {
          await act('clear-api-key', {})
          setNotice({ kind: 'ok', text: label('saved') })
        } catch (error) {
          setNotice({ kind: 'error', text: `${label('saveFailed')} ${error.message}` })
        }
      }

      async function testProvider() {
        setTesting(true)
        setNotice(null)
        try {
          await act('test-provider', {})
          setNotice({ kind: 'ok', text: label('testOk') })
        } catch (error) {
          setNotice({ kind: 'error', text: `${label('testFailed')}: ${error.message}` })
        } finally {
          setTesting(false)
        }
      }

      return h('div', { style: { maxWidth: 760 } },
        h('h3', { style: { margin: '0 0 4px' } }, label('settings')),
        h('p', { style: { ...styles.muted, marginTop: 0 } }, label('settingsHint')),

        h('div', { style: styles.field }, h('span', null, label('mode')),
          h('select', { style: styles.input, value: draft.mode, onChange: event => update('mode', event.target.value) },
            h('option', { value: 'observe' }, label('modeObserve')),
            h('option', { value: 'ask' }, label('modeAsk')),
            h('option', { value: 'enforce' }, label('modeEnforce')))),

        h('div', { style: styles.field }, h('span', null, label('onApprovalNever')),
          h('select', { style: styles.input, value: draft.onApprovalNever, onChange: event => update('onApprovalNever', event.target.value) },
            h('option', { value: 'deny' }, label('neverDeny')),
            h('option', { value: 'observe' }, label('neverObserve')))),

        h('div', { style: styles.field }, h('span', null, label('provider')),
          h('select', { style: styles.input, value: draft.provider, onChange: event => update('provider', event.target.value) },
            h('option', { value: 'off' }, label('providerOff')),
            h('option', { value: 'jev' }, label('providerJev')),
            h('option', { value: 'gemini-decision' }, label('providerGemini')))),

        h('div', { style: styles.field }, h('span', null, label('endpoint')), textField('endpoint')),
        h('div', { style: styles.field }, h('span', null, label('model')), textField('model')),
        h('div', { style: styles.field }, h('span', null, label('apiKey')),
          h('div', { style: { display: 'flex', gap: 8, alignItems: 'center' } },
            h('input', {
              type: 'password',
              style: styles.input,
              placeholder: label('apiKeyPlaceholder'),
              value: keyDraft,
              onChange: event => setKeyDraft(event.target.value),
            }),
            h('button', {
              style: styles.primary,
              onClick: () => { void saveKey() },
            }, label('saveKey')),
            key.configured === true
              ? h('button', { style: styles.button, onClick: () => { void clearKey() } }, label('clearKey'))
              : null,
            h('span', { style: styles.muted },
              key.configured === true
                ? `${label('keySet')}${key.source === undefined ? '' : ` (${key.source})`}`
                : label('keyMissing')))),
        h('div', { style: styles.field }, h('span', null, label('timeout')), numberField('timeoutMs', 100)),

        h('div', { style: styles.field }, h('span', null, label('lowConfidence')), numberField('lowConfidence', 0.05)),
        h('div', { style: styles.field }, h('span', null, label('dataEgress')), numberField('denyAboveDataEgress', 0.05)),
        h('div', { style: styles.field }, h('span', null, label('inScope')), numberField('denyBelowInScope', 0.05)),
        h('div', { style: styles.field }, h('span', null, label('destructive')), numberField('askAboveDestructive', 0.05)),
        h('div', { style: styles.field }, h('span', null, label('external')), numberField('askAboveExternal', 0.05)),

        h('div', { style: styles.field }, h('span', null, label('analyzeBinaries')), checkbox('analyzeBinaries')),
        h('div', { style: styles.field }, h('span', null, label('proposeRules')), checkbox('proposeRules')),
        h('div', { style: styles.field }, h('span', null, label('minRuns')), numberField('minRunsBeforeProposal', 1)),
        h('div', { style: styles.field }, h('span', null, label('auditMaxLines')), numberField('auditMaxLines', 100)),

        h('div', { style: { display: 'flex', gap: 12, alignItems: 'center', marginTop: 16 } },
          h('button', { style: styles.primary, onClick: () => { void save() } }, label('save')),
          h('button', { style: styles.button, disabled: testing, onClick: () => { void testProvider() } }, testing ? label('testing') : label('test')),
          notice === null ? null : h('span', { style: styles.muted }, notice.text)))
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, dictionaries), 'dsh-tool-audit: dictionaries')
        const t = ctx.locale.bind(NS)

        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: PANEL_ID,
          order: 30,
          locale: NS,
          label: () => t('panel'),
        }, AuditIcon))

        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: PANEL_ID,
          locale: NS,
        }, AuditPage))

        ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
          name: 'plugins.bundle.config',
          key: 'dsh-tool-audit',
          locale: NS,
        }, AuditSettings))
      },
    }
  },
})
