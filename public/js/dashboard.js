const view = document.getElementById('view');
const dlg = document.getElementById('dlg');
const dlgForm = document.getElementById('dlg-form');
let user = null;
let tab = 'overview';

/* ---------- helpers ---------- */
function openDialog(title, fields, onSubmit, submitLabel = 'Save') {
  dlgForm.replaceChildren();
  const err = el('div', { class: 'error', role: 'alert' });
  dlgForm.append(el('h3', {}, title));
  const inputs = {};
  const fieldContainers = {};
  for (const f of fields) {
    let input;
    if (f.type === 'select') {
      input = el('select', { id: `f-${f.name}` }, f.options.map(([v, t]) => el('option', { value: v }, t)));
    } else if (f.type === 'textarea') {
      input = el('textarea', { id: `f-${f.name}`, rows: 4, maxlength: f.max || 500 });
    } else {
      input = el('input', { id: `f-${f.name}`, type: f.type === 'password' ? 'password' : 'text', maxlength: f.max || 80, placeholder: f.placeholder || '' });
    }
    input.value = f.value ?? '';
    inputs[f.name] = input;
    const field = el('div', {},
      el('label', { for: `f-${f.name}` }, f.label),
      input,
      f.hint && el('div', { class: 'muted' }, f.hint));
    fieldContainers[f.name] = field;
    dlgForm.append(field);
  }
  const updateFieldVisibility = () => fields.forEach((f) => {
    if (f.showWhen) fieldContainers[f.name].classList.toggle('hidden', inputs[f.showWhen.field].value !== f.showWhen.value);
  });
  Object.values(inputs).forEach((input) => input.addEventListener('change', updateFieldVisibility));
  updateFieldVisibility();
  const save = el('button', { class: 'btn', type: 'submit' }, submitLabel);
  const cancel = el('button', { class: 'btn ghost', type: 'button', onclick: () => dlg.close() }, 'Cancel');
  dlgForm.append(err, el('div', { class: 'dlg-actions' }, cancel, save));
  dlgForm.onsubmit = async (e) => {
    e.preventDefault();
    save.disabled = true;
    err.textContent = '';
    try {
      const values = Object.fromEntries(Object.entries(inputs).map(([k, i]) => [k, i.value]));
      await onSubmit(values);
      dlg.close();
    } catch (ex) {
      err.textContent = ex.message;
    } finally {
      save.disabled = false;
    }
  };
  dlg.showModal();
}

const fmtDate = (d) => new Date(d).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });

function toggle(checked, onChange) {
  return el('input', { type: 'checkbox', checked, title: 'On / Off', onchange: (e) => onChange(e.target.checked) });
}

async function guard(fn) {
  try {
    await fn();
  } catch (e) {
    if (e.status === 401) return location.replace('/');
    toast(e.message);
  }
}

/* ---------- views ---------- */
async function renderOverview() {
  const s = await api('/stats');
  const stat = (label, value, note, icon) => el('div', { class: 'stat' },
    el('div', { class: 'stat-label' }, label, el('span', { class: 'stat-icon', 'aria-hidden': 'true' }, icon)),
    el('b', {}, value),
    el('span', { class: 'muted' }, note));
  const ready = [
    { done: s.sources > 0, text: s.sources ? `${s.sources} source channel${s.sources === 1 ? '' : 's'} connected` : 'Add a source channel to get started' },
    { done: s.destinations > 0, text: s.destinations ? `${s.destinations} destination channel${s.destinations === 1 ? '' : 's'} connected` : 'Connect a destination to a source' },
    { done: s.promotions > 0, text: s.promotions ? `${s.promotions} promotion${s.promotions === 1 ? '' : 's'} ready` : 'Promotions are optional' },
  ];
  const forwardingOn = user.settings.forwardingEnabled;
  view.replaceChildren(
    el('div', { class: 'stats' },
      stat('Source channels', s.sources, 'Channels watched for new posts', '▣'),
      stat('Destinations', s.destinations, 'Channels linked to your sources', '⇢'),
      stat('Forwarded (24h)', s.sent24, 'Posts delivered successfully', '↗'),
      stat('Failed (24h)', s.failed24, 'Deliveries that need attention', '◷')),
    el('div', { class: 'overview-grid' },
      el('section', { class: 'card status-card' },
        el('h2', {}, 'Forwarding status'),
        el('div', { class: 'status-line' },
          el('span', { class: `status-dot${forwardingOn ? '' : ' paused'}`, 'aria-hidden': 'true' }),
          el('strong', {}, forwardingOn ? 'Forwarding is enabled' : 'Forwarding is paused')),
        el('p', { class: 'muted' }, forwardingOn
          ? 'New posts are forwarded to each source’s assigned destination channels.'
          : 'Turn forwarding back on in Settings when you are ready to resume.'),
        el('div', { class: 'overview-actions' },
          el('button', { class: 'btn', type: 'button', onclick: () => selectTab('channels') }, 'Manage channels'),
          el('button', { class: 'btn ghost', type: 'button', onclick: () => selectTab('logs') }, 'View activity'))),
      el('section', { class: 'card setup-card' },
        el('h2', {}, 'Workspace setup'),
        el('p', { class: 'muted' }, 'A quick look at your forwarding setup.'),
        el('ul', { class: 'setup-list' }, ready.map((item) =>
          el('li', {}, el('span', { class: `setup-mark${item.done ? '' : ' todo'}`, 'aria-hidden': 'true' }, item.done ? '✓' : '·'), item.text))))));
}

function channelFields(c = {}) {
  return [
    { name: 'label', label: 'Naam (apne liye)', value: c.label || '', placeholder: 'Jaise: My News Channel' },
    { name: 'chat', label: 'Channel @username ya ID', value: c.username ? '@' + c.username : c.chatId || '', placeholder: '@mychannel ya -1001234567890', hint: 'Bot us channel me admin hona chahiye.' },
  ];
}

function destinationFields(c = {}, sources = []) {
  return [
    { name: 'label', label: 'Naam (apne liye)', value: c.label || '', placeholder: 'Jaise: My Updates Channel' },
    { name: 'chat', label: 'Channel @username ya ID', value: c.username ? '@' + c.username : c.chatId || '', placeholder: '@mychannel ya -1001234567890', hint: 'Bot ko destination me post karne ki permission honi chahiye.' },
    {
      name: 'sourceId',
      label: 'Linked source channel',
      type: 'select',
      value: c.sourceId || '',
      options: [['', 'Select a source'], ...sources.map((s) => [s._id, s.label || s.title])],
    },
  ];
}

async function renderChannels() {
  const { channels } = await api('/channels');
  const sources = channels.filter((c) => c.role === 'source');
  const destinations = channels.filter((c) => c.role === 'destination');
  const renderChannelActions = (channel) => el('div', { class: 'channel-actions' },
    el('span', { class: `channel-state${channel.enabled ? ' is-on' : ''}` }, channel.enabled ? 'Active' : 'Paused'),
    toggle(channel.enabled, (enabled) => guard(async () => {
      await api(`/channels/${channel._id}`, { method: 'PUT', body: { enabled } });
      toast(enabled ? 'Channel enabled' : 'Channel paused');
      renderChannels();
    })),
    el('button', {
      class: 'btn ghost small',
      type: 'button',
      onclick: () => openDialog(
        channel.role === 'source' ? 'Edit source channel' : 'Edit destination channel',
        channel.role === 'source' ? channelFields(channel) : destinationFields(channel, sources),
        async (values) => {
          await api(`/channels/${channel._id}`, { method: 'PUT', body: values });
          toast('Channel updated');
          renderChannels();
        },
      ),
    }, 'Edit'),
    channel.role === 'source' && el('button', {
      class: 'btn ghost small',
      type: 'button',
      onclick: () => openDialog('Report source channel', [
        { name: 'reason', label: 'Why are you reporting this source?', type: 'textarea', max: 500, hint: 'An admin will review the report. It will not be blocked automatically.' },
      ], async (values) => {
        await api(`/channels/${channel._id}/report`, { method: 'POST', body: values });
        toast('Report sent for admin review');
      }, 'Submit report'),
    }, 'Report'),
    el('button', {
      class: 'btn danger small',
      type: 'button',
      onclick: () => confirm('Remove this channel?') && guard(async () => {
        await api(`/channels/${channel._id}`, { method: 'DELETE' });
        toast('Channel removed');
        renderChannels();
      }),
    }, 'Delete'));
  const renderDestination = (channel) => el('div', { class: 'destination-item' },
    el('span', { class: 'channel-avatar destination-avatar', 'aria-hidden': 'true' }, '↗'),
    el('div', { class: 'channel-details' },
      el('strong', {}, channel.label || channel.title),
      el('span', {}, channel.username ? `@${channel.username}` : channel.chatId)),
    renderChannelActions(channel));
  const renderSourceSettings = (source) => {
    const settings = {
      forwardingEnabled: source.settings?.forwardingEnabled ?? user.settings?.forwardingEnabled ?? true,
      promotionEnabled: source.settings?.promotionEnabled ?? user.settings?.promotionEnabled ?? true,
      keepForwardTag: source.settings?.keepForwardTag ?? user.settings?.keepForwardTag ?? false,
    };
    const options = [
      ['forwardingEnabled', 'Forward posts'],
      ['promotionEnabled', 'Add promotion'],
      ['keepForwardTag', 'Keep forwarded-from tag'],
    ];
    return el('div', { class: 'source-settings' },
      el('strong', { class: 'source-settings-title' }, 'Forwarding settings'),
      el('div', { class: 'source-settings-options' }, options.map(([key, label]) =>
        el('label', { class: 'source-setting' },
          toggle(settings[key], (enabled) => guard(async () => {
            const result = await api(`/channels/${source._id}/settings`, {
              method: 'PATCH',
              body: { [key]: enabled },
            });
            source.settings = result.channel.settings;
            toast(`${label} ${enabled ? 'enabled' : 'disabled'} for this source`);
            renderChannels();
          })),
          el('span', {}, label)))));
  };
  const sourceCards = sources.map((source) => {
    const linkedDestinations = destinations.filter((destination) => destination.sourceId === source._id);
    return el('article', { class: 'route-card' },
      el('section', { class: 'route-source' },
        el('div', { class: 'route-column-heading' },
          el('span', { class: 'route-heading-icon source-heading-icon', 'aria-hidden': 'true' }, '↗'),
          el('div', {}, el('h2', {}, 'Source channel'), el('span', {}, 'Posts are read from here'))),
        el('div', { class: 'channel-item source-item' },
          el('span', { class: 'channel-avatar', 'aria-hidden': 'true' }, '✦'),
          el('div', { class: 'channel-details' },
            el('strong', {}, source.label || source.title),
            el('span', {}, source.username ? `@${source.username}` : source.chatId)),
          renderChannelActions(source)),
        renderSourceSettings(source)),
      el('div', { class: 'route-connector', 'aria-hidden': 'true' }, '→'),
      el('section', { class: 'route-destinations' },
        el('div', { class: 'route-column-heading' },
          el('span', { class: 'route-heading-icon destination-heading-icon', 'aria-hidden': 'true' }, '⇢'),
          el('div', {}, el('h2', {}, 'Destination channels'), el('span', {}, 'Posts will be sent here')),
          el('span', { class: 'route-count' }, linkedDestinations.length)),
        linkedDestinations.length
          ? el('div', { class: 'destination-list' }, linkedDestinations.map(renderDestination))
          : el('div', { class: 'destination-empty' }, 'No destinations connected yet.'),
        el('button', {
          class: 'btn ghost add-destination',
          type: 'button',
          onclick: () => openDialog('Add destination channel', channelFields(), async (values) => {
            await api('/channels', { method: 'POST', body: { ...values, role: 'destination', sourceId: source._id } });
            toast('Destination connected');
            renderChannels();
          }, 'Add destination'),
        }, '+ Add destination')));
  });
  const unassigned = destinations.filter((destination) => !sources.some((source) => source._id === destination.sourceId));
  const unassignedCard = unassigned.length
    ? el('section', { class: 'unassigned-card' },
        el('h2', {}, 'Unassigned destinations'),
        el('p', { class: 'muted' }, 'Choose a source by editing these channels before they can receive posts.'),
        el('div', { class: 'destination-list' }, unassigned.map(renderDestination)))
    : null;
  const empty = !sources.length
    ? el('section', { class: 'channels-empty' },
        el('span', { class: 'empty-icon', 'aria-hidden': 'true' }, '▣'),
        el('h2', {}, 'Start with a source channel'),
        el('p', {}, 'Add the Telegram channel you want to monitor. You can connect one or more destinations after that.'),
        el('button', {
          class: 'btn',
          type: 'button',
          onclick: () => openDialog('Add source channel', channelFields(), async (values) => {
            await api('/channels', { method: 'POST', body: { ...values, role: 'source' } });
            toast('Source channel connected');
            renderChannels();
          }, 'Add source'),
        }, '+ Add source channel'))
    : null;
  view.replaceChildren(
    el('div', { class: 'channels-toolbar' },
      el('div', {}, el('strong', {}, `${sources.length} source${sources.length === 1 ? '' : 's'}`), el('span', {}, `${destinations.length} destination${destinations.length === 1 ? '' : 's'}`)),
      el('button', {
        class: 'btn',
        type: 'button',
        onclick: () => openDialog('Add source channel', channelFields(), async (values) => {
          await api('/channels', { method: 'POST', body: { ...values, role: 'source' } });
          toast('Source channel connected');
          renderChannels();
        }, 'Add source'),
      }, '+ Add source channel')),
    el('div', { class: 'route-list' }, empty, sourceCards, unassignedCard));
}

function promoFields(p = {}, sources = []) {
  return [
    {
      name: 'sourceId',
      label: 'Select source channel',
      type: 'select',
      value: p.sourceId || '',
      options: [['', 'Choose a source channel'], ...sources.map((source) => [source._id, source.label || source.title])],
      hint: 'This promotion will only be used for posts from this source.',
    },
    { name: 'name', label: 'Promotion name', value: p.name || '', placeholder: 'e.g. Weekly offer', max: 60 },
    { name: 'text', label: 'Promotion text', type: 'textarea', value: p.text || '', max: 500, hint: 'Added below posts forwarded from the selected source. Up to 500 characters.' },
  ];
}

async function renderPromotions() {
  const [{ promotions }, { channels }] = await Promise.all([api('/promotions'), api('/channels')]);
  const sources = channels.filter((channel) => channel.role === 'source');
  const openPromotionDialog = (promotion = {}) => {
    if (!sources.length) {
      toast('Add a source channel before creating promotions');
      selectTab('channels');
      return;
    }
    openDialog(promotion._id ? 'Edit promotion' : 'Create promotion', promoFields(promotion, sources), async (values) => {
      await api(promotion._id ? `/promotions/${promotion._id}` : '/promotions', {
        method: promotion._id ? 'PUT' : 'POST',
        body: values,
      });
      toast(promotion._id ? 'Promotion updated' : 'Promotion created');
      renderPromotions();
    }, promotion._id ? 'Save changes' : 'Create promotion');
  };
  const renderPromotion = (promotion) => el('article', { class: 'promotion-card' },
    el('div', { class: 'promotion-card-top' },
      el('span', { class: 'promotion-mark', 'aria-hidden': 'true' }, '✦'),
      el('div', { class: 'promotion-heading' },
        el('strong', {}, promotion.name),
        el('span', { class: `promotion-state${promotion.enabled ? ' is-on' : ''}` }, promotion.enabled ? 'Active' : 'Paused')),
      toggle(promotion.enabled, (enabled) => guard(async () => {
        await api(`/promotions/${promotion._id}`, { method: 'PUT', body: { enabled } });
        toast(enabled ? 'Promotion enabled' : 'Promotion paused');
        renderPromotions();
      }))),
    el('p', { class: 'promotion-copy' }, promotion.text),
    el('div', { class: 'promotion-card-actions' },
      el('button', { class: 'btn ghost small', type: 'button', onclick: () => openPromotionDialog(promotion) }, 'Edit'),
      el('button', {
        class: 'btn danger small',
        type: 'button',
        onclick: () => confirm('Delete this promotion?') && guard(async () => {
          await api(`/promotions/${promotion._id}`, { method: 'DELETE' });
          toast('Promotion deleted');
          renderPromotions();
        }),
      }, 'Delete')));
  const groups = sources.map((source) => ({
    source,
    promotions: promotions.filter((promotion) => promotion.sourceId === source._id),
  }));
  const legacyPromotions = promotions.filter((promotion) => !('sourceId' in promotion));
  const unassignedPromotions = promotions.filter((promotion) => 'sourceId' in promotion && !promotion.sourceId);
  const sections = groups.map(({ source, promotions: sourcePromotions }) =>
    el('section', { class: 'promotion-source-section' },
      el('div', { class: 'promotion-source-heading' },
        el('div', {},
          el('span', { class: 'eyebrow' }, 'SOURCE CHANNEL'),
          el('h2', {}, source.label || source.title),
          el('span', { class: 'muted' }, source.username ? `@${source.username}` : source.chatId)),
        el('span', { class: 'promotion-count' }, `${sourcePromotions.length} promotion${sourcePromotions.length === 1 ? '' : 's'}`)),
      sourcePromotions.length
        ? el('div', { class: 'promotion-grid' }, sourcePromotions.map(renderPromotion))
        : el('div', { class: 'promotion-empty' }, 'No promotions for this source yet.'),
      el('button', { class: 'btn ghost add-promotion', type: 'button', onclick: () => openPromotionDialog({ sourceId: source._id }) }, '+ Add promotion')));
  if (legacyPromotions.length) {
    sections.push(el('section', { class: 'promotion-source-section legacy-promotions' },
      el('div', { class: 'promotion-source-heading' },
        el('div', {},
          el('span', { class: 'eyebrow' }, 'LEGACY PROMOTIONS'),
          el('h2', {}, 'Previously shared promotions'),
          el('span', { class: 'muted' }, 'These older promotions still apply to every source until assigned.')),
        el('span', { class: 'promotion-count' }, `${legacyPromotions.length} promotion${legacyPromotions.length === 1 ? '' : 's'}`)),
      el('div', { class: 'promotion-grid' }, legacyPromotions.map(renderPromotion))));
  }
  if (unassignedPromotions.length) {
    sections.push(el('section', { class: 'promotion-source-section unassigned-promotions' },
      el('div', { class: 'promotion-source-heading' },
        el('div', {},
          el('span', { class: 'eyebrow' }, 'SOURCE REQUIRED'),
          el('h2', {}, 'Unassigned promotions'),
          el('span', { class: 'muted' }, 'Edit each promotion and choose a source to resume using it.')),
        el('span', { class: 'promotion-count' }, `${unassignedPromotions.length} promotion${unassignedPromotions.length === 1 ? '' : 's'}`)),
      el('div', { class: 'promotion-grid' }, unassignedPromotions.map(renderPromotion))));
  }
  view.replaceChildren(
    el('div', { class: 'promotion-toolbar' },
      el('div', {},
        el('strong', {}, `${promotions.length} promotion${promotions.length === 1 ? '' : 's'}`),
        el('span', {}, ' · '),
        el('span', {}, `${sources.length} source${sources.length === 1 ? '' : 's'}`)),
      el('button', {
        class: 'btn',
        type: 'button',
        disabled: !sources.length,
        title: sources.length ? 'Create a source-specific promotion' : 'Add a source channel first',
        onclick: () => openPromotionDialog(),
      }, '+ Create promotion')),
    !sources.length
      ? el('section', { class: 'channels-empty' },
          el('span', { class: 'empty-icon', 'aria-hidden': 'true' }, '✦'),
          el('h2', {}, 'Add a source to create promotions'),
          el('p', {}, 'Each promotion is linked to a source channel, so each channel can have its own message.'),
          el('button', { class: 'btn', type: 'button', onclick: () => selectTab('channels') }, 'Go to channels'))
      : el('div', { class: 'promotion-sections' }, sections));
}

async function renderLogs() {
  const { logs } = await api('/logs');
  const list = logs.length
    ? logs.map((l) =>
        el('div', { class: 'row' },
          el('div', { class: 'info' },
            el('strong', {}, `${l.sourceTitle || '?'} → ${l.destTitle || '?'}`),
            el('span', { class: `badge ${l.status === 'sent' ? 'ok' : 'fail'}` }, l.status),
            l.promoted && el('span', { class: 'badge' }, 'promo'),
            el('div', { class: 'muted' }, fmtDate(l.createdAt) + (l.error ? ' · ' + l.error : '')))))
    : el('div', { class: 'empty' }, 'Abhi koi activity nahi hai.');
  view.replaceChildren(el('div', { class: 'card' }, el('div', { class: 'head' }, el('h2', {}, 'Recent activity'),
    el('button', { class: 'btn ghost small', type: 'button', onclick: render }, 'Refresh')), list));
}

async function renderAdmin() {
  const [summary, userData, reportData, blocklistData] = await Promise.all([
    api('/admin/summary'),
    api('/admin/users'),
    api('/admin/reports?status=pending'),
    api('/admin/blocklist'),
  ]);
  const stat = (label, value, note, icon) => el('div', { class: 'stat' },
    el('div', { class: 'stat-label' }, label, el('span', { class: 'stat-icon', 'aria-hidden': 'true' }, icon)),
    el('b', {}, value),
    el('span', { class: 'muted' }, note));
  const userRows = userData.users.length
    ? userData.users.map((account) => el('div', { class: 'row' },
      el('div', { class: 'info' },
        el('strong', {}, account.name),
        el('div', { class: 'muted' }, account.email),
        el('div', { class: 'muted' }, `Joined ${fmtDate(account.createdAt)} · ${account.emailVerified ? 'Verified' : 'Unverified'}`)),
      el('div', { class: 'admin-usage' },
        el('span', { class: 'badge' }, `${account.sent24h} sent / 24h`),
        el('span', { class: `badge${account.failed24h ? ' fail' : ''}` }, `${account.failed24h} failed / 24h`),
        ...account.riskSignals.map((signal) => el('span', { class: 'badge fail' }, signal))))
    )
    : el('div', { class: 'empty' }, 'No registered users yet.');
  const reportRows = reportData.reports.length
    ? reportData.reports.map((report) => el('div', { class: 'row' },
      el('div', { class: 'info' },
        el('strong', {}, report.title || report.chatId),
        el('div', { class: 'muted' }, `${report.username ? `@${report.username} · ` : ''}${report.chatId}`),
        el('div', { class: 'muted' }, `Reported by ${report.reporterEmail} · ${fmtDate(report.createdAt)}`),
        el('div', {}, report.reason || 'No details provided')),
      el('div', { class: 'actions' },
        el('button', { class: 'btn danger small', type: 'button', onclick: () => guard(async () => {
          if (!confirm('Block this source system-wide? Existing source routes will be paused.')) return;
          await api(`/admin/reports/${report._id}/block`, { method: 'POST' });
          toast('Source blocked system-wide');
          await guard(renderAdmin);
        }) }, 'Block source'),
        el('button', { class: 'btn ghost small', type: 'button', onclick: () => guard(async () => {
          await api(`/admin/reports/${report._id}/dismiss`, { method: 'POST' });
          toast('Report dismissed');
          await guard(renderAdmin);
        }) }, 'Dismiss')))
    )
    : el('div', { class: 'empty' }, 'No pending source reports.');
  const blockedRows = blocklistData.channels.length
    ? blocklistData.channels.map((channel) => el('div', { class: 'row' },
      el('div', { class: 'info' },
        el('strong', {}, channel.title || channel.chatId),
        el('div', { class: 'muted' }, `${channel.username ? `@${channel.username} · ` : ''}${channel.chatId} · Blocked ${fmtDate(channel.blockedAt)}`),
        el('div', {}, channel.reason || 'No report details provided')),
      el('button', { class: 'btn ghost small', type: 'button', onclick: () => guard(async () => {
        if (!confirm('Unblock this source? Existing channel routes will remain paused.')) return;
        await api(`/admin/blocklist/${encodeURIComponent(channel.chatId)}`, { method: 'DELETE' });
        toast('Source unblocked; owners may enable it again');
        await guard(renderAdmin);
      }) }, 'Unblock'))
    )
    : el('div', { class: 'empty' }, 'No blocked sources.');
  view.replaceChildren(
    el('div', { class: 'stats' },
      stat('Registered users', summary.totalUsers, `${summary.newUsers30d} joined in 30 days`, '♙'),
      stat('Successful forwards (30d)', summary.sent30d, `${summary.sent24h} in the last 24 hours`, '↗'),
      stat('Revenue', 'Not configured', 'Connect billing to track revenue', '$'),
      stat('Moderation queue', summary.pendingReports, `${summary.blockedSources} sources blocked`, '⚑')),
    el('section', { class: 'card' },
      el('div', { class: 'head' }, el('h2', {}, 'Most active users (24h) and risk signals'),
        el('button', { class: 'btn ghost small', type: 'button', onclick: () => guard(renderAdmin) }, 'Refresh')),
      el('p', { class: 'muted' }, `Recent delivery records are retained for ${summary.usageWindowDays} days. A risk signal is only a review hint, not proof of abuse or an automatic suspension. High-volume signal: ${summary.riskRules.highVolumeSent24h}+ successes/24h. High-failure signal: at least ${summary.riskRules.minimumAttempts24h} attempts and ${Math.round(summary.riskRules.highFailureRate * 100)}% failures.`),
      userRows),
    el('section', { class: 'card' }, el('div', { class: 'head' }, el('h2', {}, 'Pending source reports'), el('span', { class: 'badge' }, reportData.reports.length)), reportRows),
    el('section', { class: 'card' }, el('div', { class: 'head' }, el('h2', {}, 'System-wide source blocklist'), el('span', { class: 'badge' }, blocklistData.channels.length)), blockedRows));
}

function renderSettings() {
  view.replaceChildren(
    el('div', { class: 'card' }, el('h2', {}, 'Per-source forwarding'),
      el('p', { class: 'muted' }, 'Forwarding, promotion, and forwarded-from options are configured separately on each source in the Channels tab.')),
    el('div', { class: 'card' }, el('h2', {}, 'Password badlo'),
      el('button', { class: 'btn ghost', type: 'button', onclick: () => openDialog('Password badlo', [
        { name: 'oldPassword', label: 'Purana password', type: 'password', max: 100 },
        { name: 'newPassword', label: 'Naya password (min 8)', type: 'password', max: 100 },
      ], async (v) => { await api('/me/password', { method: 'POST', body: v }); toast('Password badal gaya'); }) }, 'Change password')));
}

const pageDetails = {
  overview: ['Overview', 'Track your channels and forwarding activity from one place.', 'Workspace', 'Your Telegram forwarding at a glance'],
  channels: ['Channels', 'Connect source channels and choose where each one forwards posts.', 'Channels', 'Manage your source and destination channels'],
  promotions: ['Promotions', 'Create and manage promotional text added to forwarded posts.', 'Promotions', 'Manage your post promotions'],
  logs: ['Activity logs', 'Review recent delivery results and troubleshoot failed posts.', 'Activity logs', 'Recent forwarding activity'],
  settings: ['Settings', 'Manage your account; forwarding options are set separately for each source.', 'Settings', 'Preferences and account security'],
  admin: ['Admin dashboard', 'Review user activity, usage signals, reports, and blocked sources.', 'Administration', 'Platform overview and moderation'],
};

function selectTab(nextTab) {
  tab = nextTab;
  document.querySelectorAll('#nav button').forEach((button) => button.classList.toggle('active', button.dataset.tab === tab));
  const [title, subtitle, topTitle, topSubtitle] = pageDetails[tab];
  document.getElementById('page-title').textContent = title;
  document.getElementById('page-subtitle').textContent = subtitle;
  document.getElementById('topbar-title').textContent = topTitle;
  document.getElementById('topbar-subtitle').textContent = topSubtitle;
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebar-backdrop').classList.remove('open');
  render();
}

async function render() {
  await guard(async () => {
    if (tab === 'overview') await renderOverview();
    else if (tab === 'channels') await renderChannels();
    else if (tab === 'promotions') await renderPromotions();
    else if (tab === 'logs') await renderLogs();
    else if (tab === 'admin' && user.isAdmin) await renderAdmin();
    else renderSettings();
  });
}

/* ---------- boot ---------- */
(async () => {
  try {
    user = (await api('/me')).user;
  } catch {
    return location.replace('/');
  }
  document.getElementById('who').textContent = user.name;
  document.getElementById('user-avatar').textContent = user.name.trim().charAt(0).toUpperCase();
  document.querySelector('#nav [data-tab="admin"]').classList.toggle('hidden', !user.isAdmin);
  document.getElementById('nav').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-tab]');
    if (!b) return;
    selectTab(b.dataset.tab);
  });
  const sidebar = document.getElementById('sidebar');
  const backdrop = document.getElementById('sidebar-backdrop');
  const closeSidebar = () => {
    sidebar.classList.remove('open');
    backdrop.classList.remove('open');
  };
  document.getElementById('mobile-menu').onclick = () => {
    sidebar.classList.add('open');
    backdrop.classList.add('open');
  };
  backdrop.onclick = closeSidebar;
  document.getElementById('logout').onclick = async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => {});
    location.replace('/');
  };
  render();
})();
