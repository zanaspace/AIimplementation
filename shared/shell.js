/* Builds the CICOD app chrome around a page's mock screen.
   Usage: <div class="shell" data-app="ecms" data-active="Create Task" data-title="All Tasks">
            <div class="shell__content"> ...mock screen... </div>
          </div>
   The nav trees mirror what the live cicod tenant showed on 27 Sep 2026. */
(function () {
  const APPS = [
    { id: 'workspace', label: 'Home', icon: 'H' },
    { id: 'ecms', label: 'CICOD ECMS', icon: 'E' },
    { id: 'inmail', label: 'CICOD InMail', icon: 'M' },
    { id: 'drive', label: 'CICOD Drive', icon: 'D' },
    { id: 'ims', label: 'Asset Mgmt', icon: 'A' },
    { id: 'conference', label: 'Conference', icon: 'C' },
    { id: 'pms', label: 'CICOD PMS', icon: 'P' },
    { id: 'portal', label: 'Service Portal', icon: 'S' },
  ];

  const NAV = {
    workspace: [['Home'], ['Calendar'], ['Request'], ['Inter-MDA'], ['Administration'], ['Mobile apps'], ['CICOD Desktop']],
    ecms: [
      ['Overview'],
      ['Dashboard', ['Workflow Dashboard', 'Status Dashboard', 'Resource Utilization']],
      ['Requests'],
      ['Tasks', ['Create Task', 'All Tasks', 'Task Approvals']],
      ['Memos', ['Create Memo', 'Memos & Drafts']],
      ['Workflows', ['Create Workflow', 'My Workflows']],
      ['Workgroups'],
      ['Forms', ['Create Form', 'All Forms', 'Form Analytics']],
      ['Contacts'],
      ['Users', ['Departments', 'Roles', 'Users']],
      ['Resources', ['All Resources', 'Resource Type', 'Resource Level', 'Resource Shift', 'Resource Schedule']],
      ['Reports', ['Reports', 'Audit Log']],
      ['Settings', ['Email Integration', 'Setup Wizard', 'Task Routing', 'Manage Call Drivers']],
    ],
    inmail: [['Inbox'], ['Sent'], ['Drafts'], ['Circular', ['All Circulars', 'Draft circulars']], ['Broadcast'], ['Flagged'], ['Starred']],
    drive: [['My Documents'], ['Collaborations'], ['Departments'], ['Historic Files'], ['General Documents'], ['Application Documents'], ['Recent'], ['Starred'], ['Trash'], ['Audit Log'], ['Approval Log']],
    ims: [
      ['Asset Registry'], ['Dashboard'],
      ['Asset', ['Asset Categories', 'Manage Asset', 'Receive Asset', 'Reserved & Pickup', 'Stock Taking Mang.', 'Stock Transfer', 'Bin Card View', 'Update Asset Status']],
      ['Supplier'], ['Returns'], ['Approval'], ['Repository'],
      ['Settings', ['Manage UOM', 'Email Alert', 'Payables', 'Audit']],
    ],
    conference: [['Room(s)'], ['Recordings'], ['Invites History'], ['Attendance']],
    pms: [['My Goals'], ['Appraisals'], ['Team Reviews'], ['Reports']],
    portal: [['Engage Us'], ['Track Engagement'], ['Verify Staff']],
  };

  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function buildNav(app, active) {
    return (NAV[app] || []).map(([group, items]) => {
      if (!items) return `<div class="shell__nav-group ${group === active ? 'shell__nav-group--active' : ''}">${esc(group)}</div>`;
      const open = items.includes(active);
      return `<div class="shell__nav-group">${esc(group)}<span>${open ? '▾' : '▸'}</span></div>` +
        (open ? items.map(i => `<div class="shell__nav-item ${i === active ? 'shell__nav-item--active' : ''}">${esc(i)}</div>`).join('') : '');
    }).join('');
  }

  function mount(shell) {
    const app = shell.dataset.app || 'ecms';
    const active = shell.dataset.active || '';
    const content = shell.querySelector('.shell__content');
    const rail = APPS.map(a => `<div class="shell__rail-app ${a.id === app ? 'shell__rail-app--active' : ''}"><div class="shell__rail-icon">${a.icon}</div>${esc(a.label)}</div>`).join('');
    const topExtra = shell.dataset.topSlot ? document.getElementById(shell.dataset.topSlot) : null;

    shell.innerHTML = `
      <aside class="shell__rail" aria-hidden="true">${rail}</aside>
      <nav class="shell__side" aria-label="Module navigation">
        <div class="shell__brand"><span class="shell__brand-logo"></span>CICOD</div>
        ${buildNav(app, active)}
      </nav>
      <div class="shell__main">
        <div class="shell__top">
          <button class="g-btn g-btn--sm" type="button">+ Quick Actions</button>
          <span class="shell__top-spacer"></span>
          <span class="shell__top-slot"></span>
          <span class="shell__avatar">PE</span>
        </div>
      </div>`;
    const main = shell.querySelector('.shell__main');
    if (topExtra) shell.querySelector('.shell__top-slot').appendChild(topExtra);
    if (content) main.appendChild(content);
  }

  document.querySelectorAll('.shell').forEach(mount);
})();
