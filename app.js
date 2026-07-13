/* ===== מתכנן מערכת השעות — לוגיקה ===== */
'use strict';

const STORAGE_KEY = 'maarechet-shaot-v1';
const UNLOCK_KEY = 'maarechet-shaot-unlocked';
// טביעת אצבע (SHA-256) של הסיסמה — הסיסמה עצמה לא מופיעה בקוד
const PASS_HASH = '70dfd884ba653f643467d4121e9213811358049a242df0b9b715e7d8ea4e3fa6';
const DAYS = ['א', 'ב', 'ג', 'ד', 'ה', 'ו'];
const LESSON_TYPES = ['פרונטלי', 'מגמה', 'פרטני', 'שהות', 'תפקיד', 'שחרית', 'ייעוץ', 'אחר'];
// מיפוי סוג שעה -> קטגוריית מכסה
const TYPE_TO_CAT = {
  'פרונטלי': 'frontal', 'מגמה': 'frontal', 'שחרית': 'frontal', 'אחר': 'frontal',
  'פרטני': 'prati', 'תפקיד': 'prati', 'ייעוץ': 'prati',
  'שהות': 'shehut'
};
const CAT_LABELS = { frontal: 'פרונטלי', prati: 'פרטני', shehut: 'שהות' };

const PALETTE = ['#6c5ce7', '#00b894', '#e17055', '#0984e3', '#fdcb6e', '#e84393',
  '#00cec9', '#a29bfe', '#fab1a0', '#55efc4', '#ff7675', '#74b9ff',
  '#b8860b', '#6ab04c', '#eb4d4b', '#22a6b3', '#be2edd', '#f0932b'];

/* ===== מצב ===== */
let state = null;

function emptyState() {
  return {
    settings: { schoolName: '', year: 'תשפ"ז', hoursDefault: 9, hoursFriday: 4 },
    teachers: [], classes: [], subjects: [], lessons: []
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      state = Object.assign(emptyState(), parsed);
      state.settings = Object.assign(emptyState().settings, parsed.settings || {});
      return;
    }
  } catch (e) { console.error('load failed', e); }
  state = emptyState();
}

let saveTimer = null;
function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  const ind = document.getElementById('save-indicator');
  ind.textContent = '✓ נשמר';
  ind.classList.remove('saving');
}

function uid() { return Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3); }

/* ===== עזרים ===== */
const byId = (arr, id) => arr.find(x => x.id === id);
const teacher = id => byId(state.teachers, id);
const klass = id => byId(state.classes, id);
const subject = id => byId(state.subjects, id);
const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function hoursFor(day) {
  return day === 'ו' ? (+state.settings.hoursFriday || 0) : (+state.settings.hoursDefault || 9);
}
function maxHours() {
  return Math.max(+state.settings.hoursDefault || 9, +state.settings.hoursFriday || 0);
}
function nextColor() {
  return PALETTE[state.subjects.length % PALETTE.length];
}
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast._tm);
  toast._tm = setTimeout(() => { t.hidden = true; }, 2600);
}

/* ===== ספירות ===== */
function teacherCounts(tid) {
  const c = { frontal: 0, prati: 0, shehut: 0 };
  for (const l of state.lessons) {
    if (l.teacherIds.includes(tid)) c[TYPE_TO_CAT[l.type] || 'frontal']++;
  }
  return c;
}
function classSubjectCounts(cid) {
  const m = {};
  for (const l of state.lessons) {
    if (l.classIds.includes(cid) && l.subjectId) m[l.subjectId] = (m[l.subjectId] || 0) + 1;
  }
  return m;
}
function classQuotaOf(c, sid) {
  const q = (c.subjectQuotas || []).find(x => x.subjectId === sid);
  return q ? +q.weeklyHours || 0 : 0;
}
function setClassQuota(c, sid, hours) {
  c.subjectQuotas = c.subjectQuotas || [];
  const i = c.subjectQuotas.findIndex(x => x.subjectId === sid);
  if (hours > 0) {
    if (i >= 0) c.subjectQuotas[i].weeklyHours = hours;
    else c.subjectQuotas.push({ subjectId: sid, weeklyHours: hours });
  } else if (i >= 0) c.subjectQuotas.splice(i, 1);
}
function statusClass(actual, target) {
  if (!target) return 'none';
  if (actual === target) return 'ok';
  return actual < target ? 'under' : 'over';
}

/* ===== התנגשויות ===== */
function computeConflicts() {
  const conflicts = [];
  for (const day of DAYS) {
    for (let h = 1; h <= hoursFor(day); h++) {
      const slot = state.lessons.filter(l => l.day === day && l.hour === h);
      // מורה בשני שיעורים שונים באותה שעה
      const perTeacher = {};
      for (const l of slot) for (const tid of l.teacherIds) (perTeacher[tid] = perTeacher[tid] || []).push(l.id);
      for (const [tid, ids] of Object.entries(perTeacher)) {
        if (ids.length > 1 && teacher(tid)) {
          conflicts.push({ kind: 'teacher', day, hour: h, id: tid, lessonIds: ids,
            text: 'המורה ' + teacher(tid).name + ' משובץ/ת ב-' + ids.length + ' שיעורים שונים ביום ' + day + "' שעה " + h });
        }
      }
      // שיבוץ ביום חופשי של מורה (למשל כשהיום החופשי סומן אחרי שהשיבוץ כבר היה קיים)
      for (const l of slot) for (const tid of l.teacherIds) {
        const t = teacher(tid);
        if (t && (t.freeDays || []).includes(day)) {
          conflicts.push({ kind: 'teacher', day, hour: h, id: tid, lessonIds: [l.id],
            text: 'המורה ' + t.name + ' משובץ/ת ביום החופשי שלו/ה — יום ' + day + "' שעה " + h });
        }
      }
      // הערה: כמה שיבוצים באותה כיתה באותה שעה זה מצב לגיטימי
      // (שני מורים שכל אחד מלמד תוכן אחר, קבוצות מקבילות) — לא נחשב התנגשות
    }
  }
  return conflicts;
}

function renderConflictBar() {
  const conflicts = computeConflicts();
  const bar = document.getElementById('conflict-bar');
  const list = document.getElementById('conflict-list');
  const teacherConf = conflicts.filter(c => c.kind === 'teacher');
  bar.hidden = conflicts.length === 0;
  document.getElementById('conflict-count').textContent = conflicts.length;
  list.innerHTML = conflicts.map((c, i) =>
    '<button class="conflict-item ' + (c.kind === 'class' ? 'warn' : '') + '" data-i="' + i + '">' +
    '<span class="tag">' + (c.kind === 'teacher' ? '⛔ מורה כפול:' : '⚠️ כיתה כפולה:') + '</span> ' + esc(c.text) + '</button>'
  ).join('');
  list.querySelectorAll('.conflict-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const c = conflicts[+btn.dataset.i];
      const tab = c.kind === 'teacher' ? 'teachers-board' : 'classes-board';
      switchTab(tab);
      const sel = 'td.slot[data-day="' + c.day + '"][data-hour="' + c.hour + '"][data-col="' + c.id + '"]';
      const cell = document.querySelector('#tab-' + tab + ' ' + sel);
      if (cell) {
        cell.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
        cell.classList.remove('flash'); void cell.offsetWidth; cell.classList.add('flash');
      }
    });
  });
  return conflicts;
}

/* ===== רינדור לוחות ===== */
function chipHtml(l, mode) {
  const sub = l.subjectId ? subject(l.subjectId) : null;
  const color = sub ? sub.color : '#b8bdc9';
  let mainLabel = sub ? sub.name : (l.type !== 'פרונטלי' ? l.type : 'שיעור');
  let secondLine = '';
  if (mode === 'class') {
    secondLine = l.teacherIds.map(t => teacher(t) ? teacher(t).name : '').filter(Boolean).join(' + ');
  } else {
    secondLine = l.classIds.map(c => klass(c) ? klass(c).name : '').filter(Boolean).join(' + ');
  }
  const typeBadge = (l.type && l.type !== 'פרונטלי' && (sub || mode === 'class'))
    ? ' <span class="chip-type">' + esc(l.type) + '</span>' : '';
  const shared = l.classIds.length > 1 ? ' shared' : '';
  const title = (sub ? sub.name + ' | ' : '') + l.type +
    (l.classIds.length ? ' | כיתות: ' + l.classIds.map(c => klass(c) ? klass(c).name : '').join(', ') : '') +
    (l.teacherIds.length ? ' | מורים: ' + l.teacherIds.map(t => teacher(t) ? teacher(t).name : '').join(', ') : '');
  return '<span class="chip' + shared + '" style="--sub-color:' + color + '22;--sub-border:' + color + '" title="' + esc(title) + '">' +
    '<span class="chip-subject">' + esc(mainLabel) + typeBadge + '</span>' +
    (secondLine ? '<span class="chip-teachers">' + esc(secondLine) + '</span>' : '') +
    (l.note ? '<span class="chip-note">' + esc(l.note) + '</span>' : '') +
    '</span>';
}

function teacherSummaryHtml(t) {
  const c = teacherCounts(t.id);
  const q = t.quota || { frontal: 0, prati: 0, shehut: 0 };
  const seg = cat => '<b class="' + statusClass(c[cat], +q[cat] || 0) + '">' + c[cat] + '/' + (+q[cat] || 0) + '</b>';
  return '<span class="tsum" title="פרונטלי + פרטני + שהות (בפועל/מכסה)">' +
    seg('frontal') + ' + ' + seg('prati') + ' + ' + seg('shehut') + '</span>';
}

function boardHtml(columns, mode) {
  // columns: [{id, headHtml}]
  let html = '<table class="board"><thead><tr>' +
    '<th class="col-day">יום</th><th class="col-hour">שעה</th>' +
    columns.map(col => '<th data-col="' + col.id + '">' + col.headHtml + '</th>').join('') +
    '</tr></thead><tbody>';

  const conflicts = computeConflicts();
  const confSet = new Set();
  for (const c of conflicts) confSet.add(c.kind + '|' + c.day + '|' + c.hour + '|' + c.id);
  // שיעורים שמעורבים בהתנגשות מורה — מסומנים גם בלוח הכיתות
  const badLessons = new Set();
  for (const c of conflicts) if (c.kind === 'teacher') c.lessonIds.forEach(id => badLessons.add(id));

  for (const day of DAYS) {
    const hrs = hoursFor(day);
    if (!hrs) continue;
    for (let h = 1; h <= hrs; h++) {
      html += '<tr' + (h === 1 ? ' class="day-start"' : '') + '>';
      if (h === 1) html += '<td class="col-day" rowspan="' + hrs + '">' + day + "'</td>";
      html += '<td class="col-hour">' + h + '</td>';
      for (const col of columns) {
        const lessons = state.lessons.filter(l => l.day === day && l.hour === h &&
          (mode === 'class' ? l.classIds.includes(col.id) : l.teacherIds.includes(col.id)));
        const confKey = (mode === 'class' ? 'class' : 'teacher') + '|' + day + '|' + h + '|' + col.id;
        let cls = confSet.has(confKey) ? (mode === 'class' ? ' warn-dup' : ' conflict') : '';
        if (mode === 'class' && lessons.some(l => badLessons.has(l.id))) cls = ' conflict';
        if (mode === 'teacher' && (teacher(col.id).freeDays || []).includes(day)) cls += ' dayoff';
        html += '<td class="slot' + cls + '" data-day="' + day + '" data-hour="' + h + '" data-col="' + col.id + '">' +
          lessons.map(l => chipHtml(l, mode)).join('') + '</td>';
      }
      html += '</tr>';
    }
  }
  html += '</tbody></table>';
  return html;
}

function renderClassesBoard() {
  const wrap = document.getElementById('classes-board-wrap');
  if (!state.classes.length) {
    wrap.innerHTML = '<div class="board-hint" style="padding:30px;text-align:center">עדיין אין כיתות. אפשר להוסיף בלשונית ⚙️ הגדרות, או לטעון שם רשימות לדוגמה.</div>';
    return;
  }
  const cols = state.classes.map(c => {
    const counts = classSubjectCounts(c.id);
    const target = (c.subjectQuotas || []).reduce((a, q) => a + (+q.weeklyHours || 0), 0);
    // מול התקן נספרים רק מקצועות שהוגדר להם תקן
    const actual = target
      ? (c.subjectQuotas || []).reduce((a, q) => a + (counts[q.subjectId] || 0), 0)
      : Object.values(counts).reduce((a, b) => a + b, 0);
    const hm = teacher(c.homeroomTeacherId);
    const mini = target
      ? '<span class="quota-mini ' + statusClass(actual, target) + '" title="שעות ששובצו מול התקן הכיתתי">' + actual + '/' + target + ' שע\'</span>'
      : '<span class="quota-mini none">' + actual + ' שע\' שובצו</span>';
    return { id: c.id, headHtml: esc(c.name) + (hm ? '<br><span style="font-weight:400;font-size:.78rem">' + esc(hm.name) + '</span>' : '') + mini };
  });
  wrap.innerHTML = boardHtml(cols, 'class');
  wrap.querySelectorAll('td.slot').forEach(td => td.addEventListener('click', () => {
    if (copySource) { pasteLessonTo(td.dataset.day, +td.dataset.hour, td.dataset.col); return; }
    openLessonModal({ day: td.dataset.day, hour: +td.dataset.hour, classId: td.dataset.col });
  }));
}

function renderTeachersBoard() {
  const wrap = document.getElementById('teachers-board-wrap');
  if (!state.teachers.length) {
    wrap.innerHTML = '<div class="board-hint" style="padding:30px;text-align:center">עדיין אין מורים. אפשר להוסיף בלשונית ⚙️ הגדרות, או לטעון שם רשימות לדוגמה.</div>';
    return;
  }
  const cols = state.teachers.map(t => ({
    id: t.id,
    headHtml: esc(t.name) + '<br><span style="font-weight:400;font-size:.75rem">' + esc(t.role || '') + '</span>' + teacherSummaryHtml(t)
  }));
  wrap.innerHTML = boardHtml(cols, 'teacher');
  wrap.querySelectorAll('td.slot').forEach(td => td.addEventListener('click', () => {
    if (copySource) { toast('שכפול עובד בלוח הכיתות — עברי לשם, או ✔ סיום'); return; }
    openLessonModal({ day: td.dataset.day, hour: +td.dataset.hour, teacherId: td.dataset.col });
  }));
}

/* ===== מכסות ===== */
function renderQuotas() {
  // מורים
  const tq = document.getElementById('teacher-quotas');
  tq.innerHTML = state.teachers.map(t => {
    const c = teacherCounts(t.id);
    const q = t.quota || { frontal: 0, prati: 0, shehut: 0 };
    const bars = ['frontal', 'prati', 'shehut'].map(cat => {
      const target = +q[cat] || 0, actual = c[cat];
      const pct = target ? Math.min(100, actual / target * 100) : (actual ? 100 : 0);
      const st = statusClass(actual, target);
      return '<div class="bar-block"><div class="bar-label"><span>' + CAT_LABELS[cat] + '</span><b>' + actual + '/' + target + '</b></div>' +
        '<div class="bar ' + (st === 'over' ? 'over' : st === 'ok' ? 'ok' : '') + '"><i style="width:' + pct + '%"></i></div></div>';
    }).join('');
    return '<div class="tq-row"><div class="tq-head"><span class="tq-name">' + esc(t.name) + '</span>' +
      '<span class="tq-role">' + esc(t.role || '') + ' | מכסה: ' + (+q.frontal || 0) + '+' + (+q.prati || 0) + '+' + (+q.shehut || 0) + '</span></div>' +
      '<div class="tq-bars">' + bars + '</div></div>';
  }).join('') || '<p class="section-hint">אין מורים עדיין.</p>';

  // כיתות
  const cq = document.getElementById('class-quotas');
  cq.innerHTML = state.classes.map(c => {
    const counts = classSubjectCounts(c.id);
    const sids = new Set([...(c.subjectQuotas || []).map(q => q.subjectId), ...Object.keys(counts)]);
    if (!sids.size) return '<div class="cq-class"><h3>' + esc(c.name) + '</h3><p class="section-hint">אין תקן ואין שיבוצים עדיין.</p></div>';
    let totalT = 0, totalA = 0;
    const rows = [...sids].filter(sid => subject(sid)).map(sid => {
      const t = classQuotaOf(c, sid), a = counts[sid] || 0;
      totalT += t;
      if (t) totalA += a; // בסיכום מול התקן נספרים רק מקצועות עם תקן
      const gap = a - t;
      const gapHtml = !t ? '<span class="section-hint">ללא תקן</span>'
        : gap === 0 ? '<span class="gap-ok">✓ מדויק</span>'
        : gap < 0 ? '<span class="gap-under">חסרות ' + (-gap) + '</span>'
        : '<span class="gap-over">עודף ' + gap + '</span>';
      return '<tr><td>' + esc(subject(sid).name) + '</td><td>' + (t || '—') + '</td><td>' + a + '</td><td>' + gapHtml + '</td></tr>';
    }).join('');
    return '<div class="cq-class"><h3>' + esc(c.name) + '</h3>' +
      '<table class="cq-table"><tr><th>מקצוע</th><th>תקן שבועי</th><th>שובץ</th><th>מצב</th></tr>' + rows +
      '<tr class="cq-total"><td>סה"כ מול התקן</td><td>' + totalT + '</td><td>' + totalA + '</td><td>' +
      (totalT ? (totalA === totalT ? '<span class="gap-ok">✓ הכיתה קיבלה את מלוא התקן</span>' : totalA < totalT ? '<span class="gap-under">חסרות ' + (totalT - totalA) + ' שעות</span>' : '<span class="gap-over">עודף ' + (totalA - totalT) + ' שעות</span>') : '') +
      '</td></tr></table></div>';
  }).join('') || '<p class="section-hint">אין כיתות עדיין.</p>';
}

/* ===== מערכת אישית ===== */
function renderPersonalTargets() {
  const kind = document.getElementById('personal-kind').value;
  const sel = document.getElementById('personal-target');
  const items = kind === 'class' ? state.classes : state.teachers;
  const prev = sel.value;
  sel.innerHTML = items.map(x => '<option value="' + x.id + '">' + esc(x.name) + '</option>').join('');
  if ([...sel.options].some(o => o.value === prev)) sel.value = prev;
}

function renderPersonal() {
  renderPersonalTargets();
  const kind = document.getElementById('personal-kind').value;
  const id = document.getElementById('personal-target').value;
  const view = document.getElementById('personal-view');
  const target = kind === 'class' ? klass(id) : teacher(id);
  if (!target) { view.innerHTML = '<p class="section-hint" style="text-align:center">אין נתונים להצגה עדיין.</p>'; return; }

  let sub = '';
  if (kind === 'class') {
    const hm = teacher(target.homeroomTeacherId);
    sub = hm ? 'מחנכת: ' + hm.name : '';
  } else {
    const c = teacherCounts(target.id); const q = target.quota || {};
    sub = 'פרונטלי ' + c.frontal + '/' + (+q.frontal || 0) + ' · פרטני ' + c.prati + '/' + (+q.prati || 0) + ' · שהות ' + c.shehut + '/' + (+q.shehut || 0);
  }

  let html = '<h2 class="pv-title">' + (state.settings.schoolName ? esc(state.settings.schoolName) + ' — ' : '') + 'מערכת שעות ' + esc(state.settings.year || '') + ' — ' + esc(target.name) + '</h2>' +
    '<p class="pv-sub">' + esc(sub) + '</p>' +
    '<table class="pv-table"><tr><th style="width:42px">שעה</th>' + DAYS.map(d => '<th>' + d + "'</th>").join('') + '</tr>';
  for (let h = 1; h <= maxHours(); h++) {
    html += '<tr><td class="hour-cell">' + h + '</td>';
    for (const day of DAYS) {
      if (h > hoursFor(day)) { html += '<td style="background:#f3f2f8"></td>'; continue; }
      if (kind === 'teacher' && (target.freeDays || []).includes(day)) {
        html += '<td style="background:#f3f2f8;color:#9a96ad">' + (h === 1 ? 'יום חופשי' : '') + '</td>';
        continue;
      }
      const lessons = state.lessons.filter(l => l.day === day && l.hour === h &&
        (kind === 'class' ? l.classIds.includes(id) : l.teacherIds.includes(id)));
      html += '<td>' + lessons.map(l => chipHtml(l, kind === 'class' ? 'class' : 'teacher')).join('') + '</td>';
    }
    html += '</tr>';
  }
  html += '</table>';
  view.innerHTML = html;
}

/* ===== הגדרות ===== */
function renderSetup() {
  const s = state.settings;
  document.getElementById('set-school-name').value = s.schoolName || '';
  document.getElementById('set-year').value = s.year || '';
  document.getElementById('set-hours-default').value = s.hoursDefault;
  document.getElementById('set-hours-friday').value = s.hoursFriday;

  // מורים
  const tt = document.getElementById('teachers-table');
  tt.innerHTML = '<tr><th>שם</th><th>תפקיד</th><th>פרונטלי</th><th>פרטני</th><th>שהות</th><th>ימים חופשיים</th><th></th></tr>' +
    state.teachers.map(t => {
      const q = t.quota || {};
      const fd = t.freeDays || [];
      return '<tr data-id="' + t.id + '">' +
        '<td><input type="text" data-f="name" value="' + esc(t.name) + '"></td>' +
        '<td><select data-f="role"><option' + (t.role === 'מחנכת' ? ' selected' : '') + '>מחנכת</option><option' + (t.role === 'מקצועי' ? ' selected' : '') + '>מקצועי</option></select></td>' +
        '<td><input type="number" min="0" data-f="frontal" value="' + (+q.frontal || 0) + '"></td>' +
        '<td><input type="number" min="0" data-f="prati" value="' + (+q.prati || 0) + '"></td>' +
        '<td><input type="number" min="0" data-f="shehut" value="' + (+q.shehut || 0) + '"></td>' +
        '<td><span class="fd-wrap" title="סימון יום = המורה לא זמין/ה ביום זה">' +
          DAYS.map(d => '<label class="fd"><input type="checkbox" data-fd="' + d + '"' + (fd.includes(d) ? ' checked' : '') + '><span>' + d + '</span></label>').join('') +
        '</span></td>' +
        '<td><button class="btn-del" title="מחיקה">🗑️</button></td></tr>';
    }).join('');
  tt.querySelectorAll('tr[data-id]').forEach(tr => {
    const t = teacher(tr.dataset.id);
    tr.querySelectorAll('[data-f]').forEach(inp => inp.addEventListener('change', () => {
      const f = inp.dataset.f;
      if (f === 'name' || f === 'role') t[f] = inp.value.trim() || t[f];
      else { t.quota = t.quota || {}; t.quota[f] = +inp.value || 0; }
      save(); renderAllBoards();
    }));
    tr.querySelectorAll('[data-fd]').forEach(inp => inp.addEventListener('change', () => {
      t.freeDays = [...tr.querySelectorAll('[data-fd]:checked')].map(i => i.dataset.fd);
      save(); renderAllBoards();
    }));
    tr.querySelector('.btn-del').addEventListener('click', () => {
      const used = state.lessons.filter(l => l.teacherIds.includes(t.id)).length;
      if (!confirm('למחוק את ' + t.name + '?' + (used ? ' (משובץ/ת ב-' + used + ' שיעורים — השיבוצים יוסרו ממנו/ה)' : ''))) return;
      state.lessons.forEach(l => l.teacherIds = l.teacherIds.filter(x => x !== t.id));
      state.lessons = state.lessons.filter(l => l.teacherIds.length || l.classIds.length);
      state.classes.forEach(c => { if (c.homeroomTeacherId === t.id) c.homeroomTeacherId = null; });
      state.teachers = state.teachers.filter(x => x.id !== t.id);
      save(); renderAll();
    });
  });

  // כיתות
  const ct = document.getElementById('classes-table');
  ct.innerHTML = '<tr><th>שם הכיתה</th><th>מחנכת</th><th></th></tr>' +
    state.classes.map(c =>
      '<tr data-id="' + c.id + '">' +
      '<td><input type="text" data-f="name" value="' + esc(c.name) + '"></td>' +
      '<td><select data-f="homeroom"><option value="">—</option>' +
      state.teachers.map(t => '<option value="' + t.id + '"' + (c.homeroomTeacherId === t.id ? ' selected' : '') + '>' + esc(t.name) + '</option>').join('') +
      '</select></td>' +
      '<td><button class="btn-del" title="מחיקה">🗑️</button></td></tr>'
    ).join('');
  ct.querySelectorAll('tr[data-id]').forEach(tr => {
    const c = klass(tr.dataset.id);
    tr.querySelector('[data-f="name"]').addEventListener('change', e => { c.name = e.target.value.trim() || c.name; save(); renderAllBoards(); });
    tr.querySelector('[data-f="homeroom"]').addEventListener('change', e => { c.homeroomTeacherId = e.target.value || null; save(); renderAllBoards(); });
    tr.querySelector('.btn-del').addEventListener('click', () => {
      const used = state.lessons.filter(l => l.classIds.includes(c.id)).length;
      if (!confirm('למחוק את כיתה ' + c.name + '?' + (used ? ' (יש לה ' + used + ' שיבוצים — הם יוסרו ממנה)' : ''))) return;
      state.lessons.forEach(l => l.classIds = l.classIds.filter(x => x !== c.id));
      state.lessons = state.lessons.filter(l => l.teacherIds.length || l.classIds.length);
      state.classes = state.classes.filter(x => x.id !== c.id);
      save(); renderAll();
    });
  });

  // מקצועות
  const st = document.getElementById('subjects-table');
  st.innerHTML = '<tr><th>שם המקצוע</th><th>צבע</th><th></th></tr>' +
    state.subjects.map(sb =>
      '<tr data-id="' + sb.id + '">' +
      '<td><input type="text" data-f="name" value="' + esc(sb.name) + '"></td>' +
      '<td><input type="color" data-f="color" value="' + sb.color + '"></td>' +
      '<td><button class="btn-del" title="מחיקה">🗑️</button></td></tr>'
    ).join('');
  st.querySelectorAll('tr[data-id]').forEach(tr => {
    const sb = subject(tr.dataset.id);
    tr.querySelector('[data-f="name"]').addEventListener('change', e => { sb.name = e.target.value.trim() || sb.name; save(); renderAllBoards(); });
    tr.querySelector('[data-f="color"]').addEventListener('change', e => { sb.color = e.target.value; save(); renderAllBoards(); });
    tr.querySelector('.btn-del').addEventListener('click', () => {
      if (!confirm('למחוק את המקצוע ' + sb.name + '? שיבוצים קיימים יישארו בלי מקצוע.')) return;
      state.lessons.forEach(l => { if (l.subjectId === sb.id) l.subjectId = null; });
      state.classes.forEach(c => c.subjectQuotas = (c.subjectQuotas || []).filter(q => q.subjectId !== sb.id));
      state.subjects = state.subjects.filter(x => x.id !== sb.id);
      save(); renderAll();
    });
  });

  // מטריצת תקן כיתתי
  const mq = document.getElementById('class-quotas-table');
  if (!state.subjects.length || !state.classes.length) {
    mq.innerHTML = '<tr><td class="section-hint">כדי להזין תקן — צריך קודם מקצועות וכיתות.</td></tr>';
  } else {
    mq.innerHTML = '<tr><th>מקצוע \\ כיתה</th>' + state.classes.map(c => '<th>' + esc(c.name) + '</th>').join('') + '</tr>' +
      state.subjects.map(sb =>
        '<tr><td>' + esc(sb.name) + '</td>' +
        state.classes.map(c => {
          const v = classQuotaOf(c, sb.id);
          return '<td><input type="number" min="0" max="30" data-cid="' + c.id + '" data-sid="' + sb.id + '" value="' + (v || '') + '" placeholder="—"></td>';
        }).join('') + '</tr>'
      ).join('');
    mq.querySelectorAll('input[data-cid]').forEach(inp => inp.addEventListener('change', () => {
      setClassQuota(klass(inp.dataset.cid), inp.dataset.sid, +inp.value || 0);
      save(); renderAllBoards();
    }));
  }
}

/* ===== עוזר חכם — הצעות לתא ===== */
function freeTeachersAt(day, hour) {
  const busy = new Set();
  for (const l of state.lessons) if (l.day === day && l.hour === hour) l.teacherIds.forEach(t => busy.add(t));
  return state.teachers
    .filter(t => !busy.has(t.id) && !(t.freeDays || []).includes(day))
    .map(t => ({ t, counts: teacherCounts(t.id) }))
    .filter(x => (+x.t.quota?.frontal || 0) > 0 && x.counts.frontal < +x.t.quota.frontal);
}

function subjectTeacherIds(sid) {
  const s = new Set();
  for (const l of state.lessons) if (l.subjectId === sid) l.teacherIds.forEach(t => s.add(t));
  return s;
}

function computeSuggestions(day, hour, classId) {
  const c = klass(classId);
  if (!c) return { items: [], free: [] };
  const counts = classSubjectCounts(classId);
  const free = freeTeachersAt(day, hour);
  const freeIds = new Set(free.map(x => x.t.id));

  const gaps = (c.subjectQuotas || [])
    .map(q => ({ sid: q.subjectId, gap: (+q.weeklyHours || 0) - (counts[q.subjectId] || 0) }))
    .filter(g => g.gap > 0 && subject(g.sid))
    .sort((a, b) => b.gap - a.gap);

  const items = [];
  for (const g of gaps) {
    const experienced = subjectTeacherIds(g.sid);
    // עדיפות: מורה שכבר מלמד את המקצוע > המחנכת > כל מורה פנוי
    let cand = free.find(x => experienced.has(x.t.id));
    let why = cand ? 'מלמד/ת את המקצוע ופנוי/ה' : '';
    if (!cand && c.homeroomTeacherId && freeIds.has(c.homeroomTeacherId)) {
      cand = free.find(x => x.t.id === c.homeroomTeacherId);
      why = 'המחנכת פנויה';
    }
    if (!cand) { cand = free[0]; why = cand ? 'פנוי/ה בשעה זו' : ''; }
    items.push({ sid: g.sid, gap: g.gap, teacher: cand ? cand.t : null, why });
    if (items.length >= 5) break;
  }
  return { items, free };
}

function renderSuggestions() {
  const box = document.getElementById('smart-suggestions');
  const ctx = modalCtx;
  if (!ctx || ctx.editingId || !ctx.classId) { box.hidden = true; return; }
  const { items, free } = computeSuggestions(ctx.day, ctx.hour, ctx.classId);
  if (!items.length && !free.length) { box.hidden = true; return; }

  let html = '<p class="sugg-title">💡 הצעות חכמות לתא הזה</p>';
  if (items.length) {
    html += items.map((it, i) =>
      '<button type="button" class="sugg-item" data-i="' + i + '">' +
      '<span class="sugg-subject">' + esc(subject(it.sid).name) + '</span>' +
      '<span class="sugg-gap">חסרות ' + it.gap + ' שע\' לתקן</span>' +
      (it.teacher ? '<span class="sugg-teacher">' + esc(it.teacher.name) + ' · ' + esc(it.why) + '</span>'
        : '<span class="sugg-teacher">אין מורה פנוי כרגע</span>') +
      '</button>').join('');
  } else {
    html += '<p class="sugg-free">אין מקצועות חסרים מול התקן לכיתה זו 🎉 (או שטרם הוגדר תקן בהגדרות)</p>';
  }
  if (free.length) {
    const names = free.slice(0, 8).map(x => x.t.name).join(', ');
    html += '<p class="sugg-free"><b>פנויים בשעה זו ומתחת למכסה:</b> ' + esc(names) + (free.length > 8 ? ' ועוד ' + (free.length - 8) : '') + '</p>';
  }
  box.innerHTML = html;
  box.hidden = false;

  const { items: its } = { items };
  box.querySelectorAll('.sugg-item').forEach(btn => btn.addEventListener('click', () => {
    const it = its[+btn.dataset.i];
    document.getElementById('lesson-subject').value = subject(it.sid).name;
    document.querySelectorAll('#lesson-teachers input').forEach(cb => { cb.checked = it.teacher ? cb.value === it.teacher.id : false; });
    document.getElementById('lesson-type').value = 'פרונטלי';
    updateAssignModeUI();
    toast('ההצעה מולאה — אפשר לשנות ואז לשמור');
  }));
}

/* ===== מצב שכפול ===== */
let copySource = null; // השיבוץ שמשכפלים

function describeLesson(l) {
  const sub = l.subjectId && subject(l.subjectId) ? subject(l.subjectId).name : l.type;
  const who = l.teacherIds.map(t => teacher(t) ? teacher(t).name : '').filter(Boolean).join(' + ');
  return sub + (who ? ' · ' + who : '') + (l.note ? ' (' + l.note + ')' : '');
}

function startCopyMode(lessonId) {
  const l = byId(state.lessons, lessonId);
  if (!l) return;
  copySource = l;
  closeModal();
  document.getElementById('copy-bar-text').textContent = describeLesson(l);
  document.getElementById('copy-bar').hidden = false;
  document.body.classList.add('copying');
  switchTab('classes-board');
}

function endCopyMode() {
  copySource = null;
  document.getElementById('copy-bar').hidden = true;
  document.body.classList.remove('copying');
}

function pasteLessonTo(day, hour, classId) {
  const src = copySource;
  if (!src) return;
  const blocked = freeDayViolators(src.teacherIds, day);
  if (blocked.length) { toast('⛔ יום ' + day + "' הוא יום חופשי של: " + blocked.join(', ')); return; }
  const dup = state.lessons.some(l => l.day === day && l.hour === hour &&
    l.classIds.includes(classId) && l.subjectId === src.subjectId &&
    JSON.stringify([...l.teacherIds].sort()) === JSON.stringify([...src.teacherIds].sort()));
  if (dup) { toast('כבר קיים שיבוץ זהה בתא הזה'); return; }
  state.lessons.push({
    id: uid(), day, hour, classIds: [classId],
    teacherIds: [...src.teacherIds], subjectId: src.subjectId, type: src.type, note: src.note
  });
  save(); renderAllBoards();
  toast('✓ הודבק — אפשר להמשיך ללחוץ על תאים, ובסיום ✔');
}

/* ===== חלונית שיבוץ ===== */
let modalCtx = null; // {day, hour, classId?, teacherId?, editingId?}

// שמות המורים מתוך הרשימה שהיום הזה הוא יום חופשי שלהם
function freeDayViolators(teacherIds, day) {
  return teacherIds.map(id => teacher(id))
    .filter(t => t && (t.freeDays || []).includes(day))
    .map(t => t.name);
}

// שדה המקצוע הוא טקסט חופשי — תרגום שם ↔ מזהה, עם יצירה אוטומטית של מקצוע חדש
function resolveSubjectId(createIfMissing) {
  const name = document.getElementById('lesson-subject').value.trim();
  if (!name) return null;
  let sb = state.subjects.find(s => s.name === name);
  if (!sb && createIfMissing) {
    sb = { id: uid(), name, color: nextColor() };
    state.subjects.push(sb);
    toast('✨ נוסף מקצוע חדש: ' + name);
  }
  return sb ? sb.id : null;
}

function renderTeacherChecklist(selectedIds) {
  document.getElementById('lesson-teachers').innerHTML = state.teachers.map(t =>
    '<label><input type="checkbox" value="' + t.id + '"' + (selectedIds.includes(t.id) ? ' checked' : '') + '> ' + esc(t.name) + '</label>').join('') ||
    '<span class="section-hint">אין מורים — הקלידי שם למעלה כדי להוסיף</span>';
  document.querySelectorAll('#lesson-teachers input').forEach(cb => cb.addEventListener('change', updateAssignModeUI));
  applyTeacherFilter();
}

function applyTeacherFilter() {
  const q = document.getElementById('teacher-filter').value.trim();
  document.querySelectorAll('#lesson-teachers label').forEach(lb => {
    lb.style.display = (!q || lb.textContent.includes(q) || lb.querySelector('input').checked) ? '' : 'none';
  });
  const exact = state.teachers.some(t => t.name === q);
  const btn = document.getElementById('btn-new-teacher-inline');
  btn.hidden = !q || exact;
  if (!btn.hidden) btn.textContent = '➕ הוספת "' + q + '" כמורה חדש/ה';
}

function addInlineTeacher() {
  const name = document.getElementById('teacher-filter').value.trim();
  if (!name || state.teachers.some(t => t.name === name)) return;
  const t = { id: uid(), name, role: 'מקצועי', quota: { frontal: 0, prati: 0, shehut: 0 } };
  state.teachers.push(t);
  save();
  const checked = [...document.querySelectorAll('#lesson-teachers input:checked')].map(i => i.value);
  checked.push(t.id);
  document.getElementById('teacher-filter').value = '';
  renderTeacherChecklist(checked);
  updateAssignModeUI();
  toast('✨ נוסף/ה מורה חדש/ה: ' + name + ' (את המכסה קובעים בהגדרות)');
}

function slotLessonsFor(ctx) {
  return state.lessons.filter(l => l.day === ctx.day && l.hour === ctx.hour &&
    (ctx.classId ? l.classIds.includes(ctx.classId) : l.teacherIds.includes(ctx.teacherId)));
}

function openLessonModal(ctx) {
  modalCtx = ctx;
  const existing = slotLessonsFor(ctx);
  modalCtx.editingId = existing.length === 1 ? existing[0].id : null;
  fillModal();
  document.getElementById('modal-backdrop').hidden = false;
}

function fillModal() {
  const ctx = modalCtx;
  const colName = ctx.classId ? ('כיתה ' + (klass(ctx.classId) ? klass(ctx.classId).name : ''))
    : (teacher(ctx.teacherId) ? teacher(ctx.teacherId).name : '');
  document.getElementById('modal-title').textContent =
    'שיבוץ — יום ' + ctx.day + "' שעה " + ctx.hour + ' — ' + colName;

  // שיעורים קיימים בתא
  const existing = slotLessonsFor(ctx);
  const holder = document.getElementById('slot-lessons');
  if (existing.length) {
    holder.innerHTML = '<label style="font-weight:700;font-size:.9rem">שיבוצים בתא זה:</label>' +
      existing.map(l => {
        const sub = l.subjectId && subject(l.subjectId) ? subject(l.subjectId).name : l.type;
        const who = l.teacherIds.map(t => teacher(t) ? teacher(t).name : '').filter(Boolean).join(' + ');
        return '<div class="slot-lesson-row' + (l.id === ctx.editingId ? ' editing' : '') + '">' +
          '<span class="grow">' + esc(sub) + (who ? ' · ' + esc(who) : '') + (l.note ? ' <small>(' + esc(l.note) + ')</small>' : '') + '</span>' +
          (l.id === ctx.editingId ? '<span style="font-size:.75rem;color:var(--primary);font-weight:700">בעריכה</span>'
            : '<button class="btn small" data-edit="' + l.id + '">✏️ עריכה</button>') +
          '<button class="btn small" data-copy="' + l.id + '" title="שכפול לתאים אחרים">📋</button>' +
          '<button class="btn small danger" data-del="' + l.id + '" title="מחיקת השיבוץ הזה">🗑</button></div>';
      }).join('') +
      (ctx.editingId
        ? '<button class="btn small add" id="btn-new-in-slot">+ שיבוץ נוסף באותו תא</button>'
        : '<div class="new-in-slot-hint">➕ הטופס שלמטה יוסיף <b>שיבוץ חדש</b> לתא הזה, בנוסף לקיימים</div>');
  } else {
    holder.innerHTML = '';
  }
  holder.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => {
    modalCtx.editingId = b.dataset.edit; fillModal();
  }));
  holder.querySelectorAll('[data-copy]').forEach(b => b.addEventListener('click', () => startCopyMode(b.dataset.copy)));
  holder.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => {
    if (!confirm('למחוק את השיבוץ הזה?')) return;
    state.lessons = state.lessons.filter(l => l.id !== b.dataset.del);
    if (modalCtx.editingId === b.dataset.del) modalCtx.editingId = null;
    const remaining = slotLessonsFor(modalCtx);
    if (!modalCtx.editingId && remaining.length === 1) modalCtx.editingId = remaining[0].id;
    save(); renderAllBoards(); fillModal();
    toast('השיבוץ נמחק ✓');
  }));
  const newBtn = document.getElementById('btn-new-in-slot');
  if (newBtn) newBtn.addEventListener('click', () => { modalCtx.editingId = null; fillModal(); });

  const editing = ctx.editingId ? byId(state.lessons, ctx.editingId) : null;

  // מקצוע — הקלדה חופשית עם השלמות
  document.getElementById('subjects-datalist').innerHTML =
    state.subjects.map(sb => '<option value="' + esc(sb.name) + '"></option>').join('');
  const editSub = editing && editing.subjectId ? subject(editing.subjectId) : null;
  document.getElementById('lesson-subject').value = editSub ? editSub.name : '';

  // סוג
  document.getElementById('lesson-type').innerHTML = LESSON_TYPES.map(t =>
    '<option' + ((editing ? editing.type === t : t === 'פרונטלי') ? ' selected' : '') + '>' + t + '</option>').join('');

  // מורים — רשימה מסתננת תוך כדי הקלדה
  const selT = editing ? editing.teacherIds : (ctx.teacherId ? [ctx.teacherId] : []);
  document.getElementById('teacher-filter').value = '';
  renderTeacherChecklist(selT);
  document.getElementById('teacher-filter').oninput = applyTeacherFilter;
  document.getElementById('teacher-filter').onkeydown = e => {
    if (e.key === 'Enter' && !document.getElementById('btn-new-teacher-inline').hidden) addInlineTeacher();
  };
  document.getElementById('btn-new-teacher-inline').onclick = addInlineTeacher;

  // כיתות
  const selC = editing ? editing.classIds : (ctx.classId ? [ctx.classId] : []);
  document.getElementById('lesson-classes').innerHTML = state.classes.map(c =>
    '<label><input type="checkbox" value="' + c.id + '"' + (selC.includes(c.id) ? ' checked' : '') + '> ' + esc(c.name) + '</label>').join('') ||
    '<span class="section-hint">אין כיתות — הוסיפי בהגדרות</span>';

  document.getElementById('lesson-note').value = editing ? (editing.note || '') : '';
  document.getElementById('lesson-delete').hidden = !editing;

  // מצבי שיבוץ: כיתות (משותף/נפרד) ומורים (יחד/כל אחד תוכן משלו)
  document.querySelector('input[name="assign-mode"][value="together"]').checked = true;
  document.querySelector('input[name="teacher-mode"][value="together"]').checked = true;
  document.querySelectorAll('#lesson-classes input').forEach(cb => cb.addEventListener('change', updateAssignModeUI));
  document.querySelectorAll('input[name="assign-mode"], input[name="teacher-mode"]').forEach(r => { r.onchange = updateAssignModeUI; });
  document.getElementById('check-all-classes').onclick = () => {
    const boxes = [...document.querySelectorAll('#lesson-classes input')];
    const allChecked = boxes.every(b => b.checked);
    boxes.forEach(b => b.checked = !allChecked);
    updateAssignModeUI();
  };

  // כפתורי שכבה — לחיצה מסמנת את כל כיתות השכבה (מופיעים רק לשכבות עם 2+ כיתות)
  const grades = {};
  for (const c of state.classes) { const g = classGrade(c.name); if (g) (grades[g] = grades[g] || []).push(c.id); }
  const gradeHolder = document.getElementById('grade-buttons');
  gradeHolder.innerHTML = Object.entries(grades).filter(([, ids]) => ids.length >= 2)
    .map(([g, ids]) => '<button type="button" class="btn small" data-grade="' + g + '">שכבת ' + g + "'</button>").join('');
  gradeHolder.querySelectorAll('[data-grade]').forEach(b => b.addEventListener('click', () => {
    const ids = grades[b.dataset.grade];
    const boxes = ids.map(id => document.querySelector('#lesson-classes input[value="' + id + '"]')).filter(Boolean);
    const allChecked = boxes.every(cb => cb.checked);
    boxes.forEach(cb => { cb.checked = !allChecked; });
    updateAssignModeUI();
  }));
  updateAssignModeUI();
  renderSuggestions();
}

function updateAssignModeUI() {
  const checkedClasses = [...document.querySelectorAll('#lesson-classes input:checked')].map(i => i.value);
  const checkedTeachers = [...document.querySelectorAll('#lesson-teachers input:checked')].map(i => i.value);
  const editing = modalCtx && modalCtx.editingId;

  // מצב כיתות: משותף / נפרד לכל כיתה
  const showClassMode = !editing && checkedClasses.length >= 2;
  document.getElementById('assign-mode-row').hidden = !showClassMode;
  const classSplit = showClassMode && document.querySelector('input[name="assign-mode"]:checked').value === 'split';
  document.getElementById('teachers-row').hidden = classSplit;
  document.getElementById('split-teachers-row').hidden = !classSplit;

  // מצב מורים: יחד / כל מורה תוכן משלו
  const showTeacherMode = !editing && !classSplit && checkedTeachers.length >= 2;
  document.getElementById('teacher-mode-row').hidden = !showTeacherMode;
  const teacherEach = showTeacherMode && document.querySelector('input[name="teacher-mode"]:checked').value === 'each';
  document.getElementById('split-subjects-row').hidden = !teacherEach;
  document.getElementById('subject-row').hidden = teacherEach;

  if (classSplit) {
    const holder = document.getElementById('split-teachers');
    const prev = {}, prevSub = {};
    holder.querySelectorAll('select[data-cid]').forEach(s => { prev[s.dataset.cid] = s.value; });
    holder.querySelectorAll('select[data-cid-sub]').forEach(s => { prevSub[s.dataset.cidSub] = s.value; });
    const mainSubject = resolveSubjectId(false);
    holder.innerHTML = checkedClasses.map(cid => {
      const c = klass(cid);
      const def = (cid in prev) ? prev[cid] : (c.homeroomTeacherId || '');
      const defSub = (cid in prevSub) ? prevSub[cid] : (mainSubject || '');
      return '<div class="split-line"><span>' + esc(c.name) + '</span>' +
        '<select data-cid="' + cid + '"><option value="">— ללא מורה —</option>' +
        state.teachers.map(t => '<option value="' + t.id + '"' + (def === t.id ? ' selected' : '') + '>' +
          esc(t.name) + (c.homeroomTeacherId === t.id ? ' 🏠 (המחנכת)' : '') + '</option>').join('') +
        '</select>' +
        '<select data-cid-sub="' + cid + '" title="מקצוע לכיתה זו"><option value="">מקצוע: כמו למעלה</option>' +
        state.subjects.map(sb => '<option value="' + sb.id + '"' + (defSub === sb.id ? ' selected' : '') + '>' + esc(sb.name) + '</option>').join('') +
        '</select></div>';
    }).join('');
  }

  if (teacherEach) {
    const holder = document.getElementById('split-subjects');
    const prev = {}, prevG = {};
    holder.querySelectorAll('select').forEach(s => { prev[s.dataset.tid] = s.value; });
    holder.querySelectorAll('input[data-tid]').forEach(i => { prevG[i.dataset.tid] = i.value; });
    const mainSubject = resolveSubjectId(false);
    holder.innerHTML = checkedTeachers.map(tid => {
      const t = teacher(tid);
      const def = (tid in prev) ? prev[tid] : mainSubject;
      return '<div class="split-line"><span>' + esc(t ? t.name : '') + '</span><select data-tid="' + tid + '">' +
        '<option value="">— ללא מקצוע —</option>' +
        state.subjects.map(sb => '<option value="' + sb.id + '"' + (def === sb.id ? ' selected' : '') + '>' + esc(sb.name) + '</option>').join('') +
        '</select>' +
        '<input type="text" data-tid="' + tid + '" list="group-datalist" class="group-input" placeholder="קבוצה (מתקדמים...)" value="' + esc(prevG[tid] || '') + '">' +
        '</div>';
    }).join('');
  }
}

function closeModal() {
  document.getElementById('modal-backdrop').hidden = true;
  modalCtx = null;
}

function saveLessonFromModal() {
  const ctx = modalCtx;
  const classIds = [...document.querySelectorAll('#lesson-classes input:checked')].map(i => i.value);
  // במצב "כל מורה תוכן משלו" המקצוע נקבע פר-מורה — לא יוצרים מקצוע מהשדה הראשי המוסתר
  const teacherEachMode = !ctx.editingId && !document.getElementById('teacher-mode-row').hidden &&
    document.querySelector('input[name="teacher-mode"]:checked').value === 'each';
  const common = {
    day: ctx.day, hour: ctx.hour,
    subjectId: teacherEachMode ? null : resolveSubjectId(true),
    type: document.getElementById('lesson-type').value,
    note: document.getElementById('lesson-note').value.trim()
  };

  // שיבוץ נפרד לכל כיתה — נוצר שיעור נפרד עם המורה שנבחר לה
  const splitMode = !ctx.editingId && !document.getElementById('assign-mode-row').hidden &&
    document.querySelector('input[name="assign-mode"]:checked').value === 'split';
  if (splitMode) {
    const sels = [...document.querySelectorAll('#split-teachers select[data-cid]')];
    const blocked = freeDayViolators(sels.map(s => s.value).filter(Boolean), ctx.day);
    if (blocked.length) { toast('⛔ יום ' + ctx.day + "' הוא יום חופשי של: " + blocked.join(', ')); return; }
    for (const s of sels) {
      const subSel = document.querySelector('#split-teachers select[data-cid-sub="' + s.dataset.cid + '"]');
      const subjectId = (subSel && subSel.value) ? subSel.value : common.subjectId;
      state.lessons.push(Object.assign({ id: uid(), classIds: [s.dataset.cid], teacherIds: s.value ? [s.value] : [] }, common, { subjectId }));
    }
    save(); closeModal(); renderAllBoards();
    toast(sels.length + ' שיבוצים נשמרו — אחד לכל כיתה ✓');
    return;
  }

  const teacherIds = [...document.querySelectorAll('#lesson-teachers input:checked')].map(i => i.value);
  if (!teacherIds.length && !classIds.length) { toast('צריך לבחור לפחות מורה אחד או כיתה אחת'); return; }

  const blocked = freeDayViolators(teacherIds, ctx.day);
  if (blocked.length) { toast('⛔ יום ' + ctx.day + "' הוא יום חופשי של: " + blocked.join(', ')); return; }

  // כל מורה מלמד תוכן משלו — שיעור נפרד לכל מורה עם המקצוע שלו
  if (teacherEachMode) {
    const sels = [...document.querySelectorAll('#split-subjects select')];
    for (const s of sels) {
      const group = (document.querySelector('#split-subjects input[data-tid="' + s.dataset.tid + '"]') || {}).value || '';
      state.lessons.push(Object.assign({ id: uid(), classIds, teacherIds: [s.dataset.tid] }, common,
        { subjectId: s.value || null, note: group.trim() || common.note }));
    }
    save(); closeModal(); renderAllBoards();
    toast(sels.length + ' שיבוצים נשמרו — קבוצה לכל מורה ✓');
    return;
  }
  const data = Object.assign({ teacherIds, classIds }, common);
  if (ctx.editingId) {
    Object.assign(byId(state.lessons, ctx.editingId), data);
  } else {
    state.lessons.push(Object.assign({ id: uid() }, data));
  }
  save(); closeModal(); renderAllBoards();
  toast('השיבוץ נשמר ✓');
}

/* ===== רשימות לדוגמה מתשפ"ג ===== */
function loadSampleData() {
  if ((state.teachers.length || state.classes.length) &&
    !confirm('הרשימות לדוגמה יתווספו לרשימות הקיימות (בלי כפילויות בשמות). להמשיך?')) return;

  const q = (f, p, s) => ({ frontal: f, prati: p, shehut: s });
  const sampleTeachers = [
    ['אופיר ויצמן', 'מחנכת', q(23, 4, 9)], ['נופר סרודי', 'מחנכת', q(22, 4, 8)],
    ['מיכל פיטוסי', 'מחנכת', q(20, 4, 8)], ['ניצה אורן', 'מחנכת', q(22, 4, 8)],
    ['נוגה יצחק', 'מחנכת', q(23, 4, 9)], ['עמית חדשי', 'מחנכת', q(20, 3, 9)],
    ['סיגל כאמרן', 'מחנכת', q(20, 3, 9)], ['זהבית ברוצקי', 'מחנכת', q(22, 4, 8)],
    ['אורית מזרחי', 'מחנכת', q(20, 3, 9)], ['ליאת סגל', 'מחנכת', q(23, 4, 9)],
    ['שרית כהן טולדן', 'מחנכת', q(22, 4, 8)], ['סילבי אברג\'יל', 'מחנכת', q(21, 4, 9)],
    ['הדר שכיב', 'מקצועי', q(22, 4, 8)], ['רועי כהן', 'מקצועי', q(20, 3, 9)],
    ['אופיר קופל', 'מקצועי', q(23, 4, 9)], ['חיים פורטומלי', 'מקצועי', q(6, 1, 2)],
    ['ליטל אגוזי', 'מקצועי', q(9, 2, 3)], ['סיגל טרוזמן', 'מקצועי', q(7, 2, 2)],
    ['חגית קוריאל', 'מקצועי', q(15, 2, 6)], ['מרי גרבי', 'מקצועי', q(15, 3, 6)],
    ['מלי בוזגלו', 'מקצועי', q(9, 0, 0)], ['מוטי זגרון', 'מקצועי', q(20, 3, 9)],
    ['רפאל מוריין', 'מקצועי', q(23, 4, 9)], ['רחל הדד', 'מקצועי', q(10, 1, 4)],
    ['ליז עזרא', 'מקצועי', q(8, 0, 0)], ['שירה מרשל', 'מקצועי', q(23, 4, 9)],
    ['שרית (מנהלת)', 'מקצועי', q(6, 0, 0)], ['אודליה', 'מקצועי', q(9, 2, 3)],
    ['סופי', 'מקצועי', q(20, 1, 11)], ['רון לי', 'מקצועי', q(8, 2, 3)],
    ['מירי (של"ח)', 'מקצועי', q(6, 0, 0)]
  ];
  const sampleClasses = ['ז1', 'ז2', 'ח', 'ט1', 'ט2', 'י1', 'י2', 'י3', 'יא1', 'יא2', 'יב1', 'יב2'];
  const sampleSubjects = ['חינוך', 'שחרית', 'מתמטיקה', 'אנגלית', 'חנ"ג', 'אומנות', 'מדעים', 'שירה',
    'של"ח', 'מד"ט', 'מלונאות', 'נגרות', 'ימאות', 'עיצוב שיער', 'טיפוח החן', 'תזונה',
    'חינוך תעבורתי', 'אתגרים', 'חיי עבודה', 'מקבץ', 'תכשיטנות'];

  for (const [name, role, quota] of sampleTeachers) {
    if (!state.teachers.some(t => t.name === name)) state.teachers.push({ id: uid(), name, role, quota });
  }
  const homerooms = { 'ז1': 'אופיר ויצמן', 'ז2': 'נופר סרודי', 'ח': 'מיכל פיטוסי', 'ט1': 'ניצה אורן', 'ט2': 'נוגה יצחק', 'י1': 'עמית חדשי', 'י2': 'סיגל כאמרן', 'יא1': 'זהבית ברוצקי', 'יא2': 'אורית מזרחי', 'יב1': 'ליאת סגל', 'יב2': 'שרית כהן טולדן' };
  for (const name of sampleClasses) {
    if (!state.classes.some(c => c.name === name)) {
      const hm = state.teachers.find(t => t.name === homerooms[name]);
      state.classes.push({ id: uid(), name, homeroomTeacherId: hm ? hm.id : null, subjectQuotas: [] });
    }
  }
  for (const name of sampleSubjects) {
    if (!state.subjects.some(s => s.name === name)) state.subjects.push({ id: uid(), name, color: nextColor() });
  }
  save(); renderAll();
  toast('הרשימות נטענו — עכשיו אפשר להתאים אותן לשנה החדשה ✓');
}

/* ===== תקן שעות תשפ"ז — לפי עדכון המשתמשת ===== */
const QUOTA_TASHPAZ = [
  ['מלונאות', { 'י': 6, 'יא': 6, 'יב': 6 }],                 // מלונאות תמיד 6
  ['אנגלית', { 'ז': 2, 'ח': 2 }],                             // אנגלית ז-ח 2
  ['אנגלית מתקדמים', { 'ט': 4 }],                             // אנגלית ט מתקדמים 4
  ['אנגלית בסיס', { 'ט': 2 }],                                // אנגלית ט בסיס 2
  ['עיצוב שיער', { 'י': 5, 'יא': 6, 'יב': 2 }],               // עיצוב שיער י 5, יא 6, יב 2
  ['מתמטיקה', { 'ז': 3, 'ח': 4, 'ט': 4, 'יב': 2 }],           // מתמטיקה ז 3, ח-ט 4, יב 2
  ['מתמטיקה מתקדמים', { 'י': 5, 'יא': 5 }],                   // י-יא מתקדמים 5
  ["חינוך פיננסי (מתמ' בסיס)", { 'י': 2, 'יא': 2 }],          // י-יא בסיס 2 (חינוך פיננסי)
  ['חינוך פיננסי מתקדמים', { 'י': 1, 'יא': 1, 'יב': 1 }],     // חינוך פיננסי מתקדמים י-יב 1
  ['תזונה', { 'י': 2 }],                                       // תזונה י 2
  ['תזונה פנימי', { 'יא': 3 }],                                // תזונה יא 3 לפנימי
  ['תזונה בגרות', { 'יא': 4 }],                                // תזונה יא 4 לבגרות
  ['מד"ט', { 'י': 1, 'יא': 1, 'יב': 1 }]                       // מד"ט י-יב 1
];

function classGrade(name) {
  const m = (name || '').trim().match(/^(יג|יב|יא|י|ט|ח|ז)/);
  return m ? m[1] : null;
}

function loadQuotaTashpaz() {
  if (!state.classes.length) { toast('קודם צריך להגדיר כיתות'); return; }
  if (!confirm('יוגדר תקן שעות תשפ"ז למקצועות שברשימת העדכון, לפי שכבת כל כיתה.\nמקצועות אחרים ותקנים שכבר הגדרת ידנית למקצועות אחרים — לא ייגעו.\nלהמשיך?')) return;
  let created = 0, set = 0;
  for (const [name, byGrade] of QUOTA_TASHPAZ) {
    let sb = state.subjects.find(s => s.name === name);
    if (!sb) { sb = { id: uid(), name, color: nextColor() }; state.subjects.push(sb); created++; }
    for (const c of state.classes) {
      const g = classGrade(c.name);
      if (g && byGrade[g] != null) { setClassQuota(c, sb.id, byGrade[g]); set++; }
    }
  }
  save(); renderAll();
  toast('✓ הוגדרו ' + set + ' תקני שעות' + (created ? ', נוצרו ' + created + ' מקצועות חדשים' : ''));
}

/* ===== ייצוא / ייבוא ===== */
function exportJson() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'מערכת-שעות-' + (state.settings.year || '').replace(/["\s]/g, '') + '-' + new Date().toISOString().slice(0, 10) + '.json';
  a.click();
  URL.revokeObjectURL(a.href);
  toast('קובץ הגיבוי ירד להורדות ✓');
}

function importJson(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      if (!parsed || !Array.isArray(parsed.teachers) || !Array.isArray(parsed.lessons)) throw new Error('bad format');
      if (!confirm('הקובץ יחליף את כל הנתונים הנוכחיים. להמשיך?')) return;
      state = Object.assign(emptyState(), parsed);
      state.settings = Object.assign(emptyState().settings, parsed.settings || {});
      save(); renderAll();
      toast('הנתונים שוחזרו מהקובץ ✓');
    } catch (e) {
      toast('⚠️ הקובץ אינו קובץ גיבוי תקין');
    }
  };
  reader.readAsText(file);
}

/* ===== הדפסת סדין מלא — 6 עמודות לעמוד, כל השבוע ===== */
const SHEET_COLS_PER_PAGE = 6;

function printBoard(mode) { // 'class' | 'teacher'
  const cols = mode === 'class'
    ? state.classes.map(c => ({ id: c.id, name: c.name, sub: (teacher(c.homeroomTeacherId) || {}).name || '' }))
    : state.teachers.map(t => ({ id: t.id, name: t.name, sub: t.role || '' }));
  if (!cols.length) { toast('אין מה להדפיס עדיין'); return; }

  const chunks = [];
  for (let i = 0; i < cols.length; i += SHEET_COLS_PER_PAGE) chunks.push(cols.slice(i, i + SHEET_COLS_PER_PAGE));

  const title = (state.settings.schoolName ? esc(state.settings.schoolName) + ' — ' : '') +
    (mode === 'class' ? 'לוח כיתות' : 'לוח מורים') + ' — ' + esc(state.settings.year || '');

  document.getElementById('print-sheets').innerHTML = chunks.map((chunk, pi) => {
    let h = '<section class="print-page"><h2 class="sheet-title">' + title +
      (chunks.length > 1 ? ' (עמוד ' + (pi + 1) + ' מתוך ' + chunks.length + ')' : '') + '</h2>';
    h += '<table class="sheet-table"><tr><th class="w1">יום</th><th class="w1">שעה</th>' +
      chunk.map(c => '<th>' + esc(c.name) + (c.sub ? '<br><small>' + esc(c.sub) + '</small>' : '') + '</th>').join('') + '</tr>';
    for (const day of DAYS) {
      const hrs = hoursFor(day);
      if (!hrs) continue;
      for (let hr = 1; hr <= hrs; hr++) {
        h += '<tr' + (hr === 1 ? ' class="day-start"' : '') + '>';
        if (hr === 1) h += '<td class="dcell" rowspan="' + hrs + '">' + day + "'</td>";
        h += '<td class="hcell">' + hr + '</td>';
        for (const c of chunk) {
          const ls = state.lessons.filter(l => l.day === day && l.hour === hr &&
            (mode === 'class' ? l.classIds.includes(c.id) : l.teacherIds.includes(c.id)));
          h += '<td>' + ls.map(l => {
            const sub = l.subjectId && subject(l.subjectId) ? subject(l.subjectId).name : (l.type !== 'פרונטלי' ? l.type : '');
            const who = mode === 'class'
              ? l.teacherIds.map(t => teacher(t) ? teacher(t).name : '').filter(Boolean).join(' + ')
              : l.classIds.map(x => klass(x) ? klass(x).name : '').filter(Boolean).join(' + ');
            return '<div class="pcell"><b>' + esc(sub) + '</b>' + (who ? ' ' + esc(who) : '') +
              (l.note ? ' <i>(' + esc(l.note) + ')</i>' : '') + '</div>';
          }).join('') + '</td>';
        }
        h += '</tr>';
      }
    }
    return h + '</table></section>';
  }).join('');

  fitSheetsToPage();
  document.body.classList.add('printing-board');
  const cleanup = () => { document.body.classList.remove('printing-board'); window.removeEventListener('afterprint', cleanup); };
  window.addEventListener('afterprint', cleanup);
  window.print();
  setTimeout(cleanup, 3000); // רשת ביטחון אם afterprint לא נורה
}

// אם התוכן גבוה מדף A4 לרוחב — מכווצים את הטבלה כך שהשבוע תמיד ייכנס בעמוד אחד
function fitSheetsToPage() {
  const holder = document.getElementById('print-sheets');
  holder.style.cssText = 'display:block;position:absolute;top:0;inset-inline-start:0;width:1062px;visibility:hidden;z-index:-1';
  holder.querySelectorAll('.print-page').forEach(pg => {
    const tbl = pg.querySelector('table');
    tbl.style.transform = '';
    const title = pg.querySelector('.sheet-title');
    const avail = 726 - (title ? title.offsetHeight + 4 : 0); // גובה A4 לרוחב פחות שוליים וכותרת
    if (tbl.offsetHeight > avail) {
      const s = Math.max(0.35, avail / tbl.offsetHeight);
      tbl.style.transform = 'scale(' + s.toFixed(3) + ')';
      tbl.style.transformOrigin = 'top right';
    }
  });
  holder.style.cssText = '';
}

/* ===== טאבים ורינדור כללי ===== */
function switchTab(name) {
  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === 'tab-' + name));
  if (name === 'quotas') renderQuotas();
  if (name === 'personal') renderPersonal();
  if (name === 'setup') renderSetup();
}

function renderHeader() {
  document.getElementById('school-title').textContent =
    (state.settings.schoolName ? state.settings.schoolName + ' — ' : '') + 'מתכנן מערכת השעות';
  document.getElementById('year-subtitle').textContent = 'שנה"ל ' + (state.settings.year || '');
}

function renderAllBoards() {
  renderHeader();
  renderClassesBoard();
  renderTeachersBoard();
  renderConflictBar();
  const active = document.querySelector('.tab.active');
  if (active && active.dataset.tab === 'quotas') renderQuotas();
  if (active && active.dataset.tab === 'personal') renderPersonal();
}

function renderAll() {
  renderAllBoards();
  renderSetup();
  renderPersonalTargets();
}

/* ===== נעילת סיסמה ===== */
async function sha256hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function initLock() {
  const screen = document.getElementById('lock-screen');
  if (localStorage.getItem(UNLOCK_KEY) === '1') { screen.hidden = true; return; }
  screen.hidden = false;
  const input = document.getElementById('lock-input');
  const tryUnlock = async () => {
    let ok = false;
    try { ok = (await sha256hex(input.value)) === PASS_HASH; } catch (e) { ok = false; }
    if (ok) {
      localStorage.setItem(UNLOCK_KEY, '1');
      screen.hidden = true;
    } else {
      document.getElementById('lock-error').hidden = false;
      input.value = '';
      input.focus();
    }
  };
  document.getElementById('lock-btn').addEventListener('click', tryUnlock);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') tryUnlock(); });
  setTimeout(() => input.focus(), 50);
}

/* ===== אתחול ===== */
function init() {
  initLock();
  loadState();
  renderAll();

  document.querySelectorAll('.tab').forEach(b => b.addEventListener('click', () => switchTab(b.dataset.tab)));

  document.getElementById('conflict-toggle').addEventListener('click', () => {
    const l = document.getElementById('conflict-list');
    l.hidden = !l.hidden;
  });

  // הגדרות כלליות
  const bindSetting = (elId, key, isNum) => {
    document.getElementById(elId).addEventListener('change', e => {
      state.settings[key] = isNum ? (+e.target.value || 0) : e.target.value.trim();
      save(); renderAllBoards();
    });
  };
  bindSetting('set-school-name', 'schoolName');
  bindSetting('set-year', 'year');
  bindSetting('set-hours-default', 'hoursDefault', true);
  bindSetting('set-hours-friday', 'hoursFriday', true);

  // הוספות
  document.getElementById('btn-add-teacher').addEventListener('click', () => {
    state.teachers.push({ id: uid(), name: 'מורה חדש/ה', role: 'מקצועי', quota: { frontal: 0, prati: 0, shehut: 0 } });
    save(); renderSetup(); renderAllBoards();
  });
  document.getElementById('btn-add-class').addEventListener('click', () => {
    state.classes.push({ id: uid(), name: 'כיתה חדשה', homeroomTeacherId: null, subjectQuotas: [] });
    save(); renderSetup(); renderAllBoards();
  });
  document.getElementById('btn-add-subject').addEventListener('click', () => {
    state.subjects.push({ id: uid(), name: 'מקצוע חדש', color: nextColor() });
    save(); renderSetup(); renderAllBoards();
  });

  // נתונים
  document.getElementById('btn-load-sample').addEventListener('click', loadSampleData);
  document.getElementById('btn-load-quota').addEventListener('click', loadQuotaTashpaz);
  document.getElementById('btn-clear-lessons').addEventListener('click', () => {
    if (!confirm('למחוק את כל השיבוצים? המורים, הכיתות והמקצועות יישארו.')) return;
    state.lessons = []; save(); renderAll(); toast('כל השיבוצים נמחקו');
  });
  document.getElementById('btn-clear-all').addEventListener('click', () => {
    if (!confirm('איפוס מלא ימחק את כל הנתונים: מורים, כיתות, מקצועות ושיבוצים. האם להמשיך?')) return;
    if (!confirm('בטוחה? מומלץ להוריד קודם קובץ גיבוי (⬇ בכותרת). ללחוץ אישור למחיקה סופית.')) return;
    state = emptyState(); save(); renderAll(); toast('כל הנתונים אופסו');
  });

  // ייצוא/ייבוא
  document.getElementById('btn-export').addEventListener('click', exportJson);
  document.getElementById('btn-import').addEventListener('click', () => document.getElementById('import-file').click());
  document.getElementById('import-file').addEventListener('change', e => {
    if (e.target.files[0]) importJson(e.target.files[0]);
    e.target.value = '';
  });

  // מערכת אישית
  document.getElementById('personal-kind').addEventListener('change', renderPersonal);
  document.getElementById('personal-target').addEventListener('change', renderPersonal);
  document.getElementById('btn-print').addEventListener('click', () => window.print());
  document.getElementById('btn-print-classes').addEventListener('click', () => printBoard('class'));
  document.getElementById('btn-print-teachers').addEventListener('click', () => printBoard('teacher'));

  // חלונית
  document.getElementById('modal-close').addEventListener('click', closeModal);
  document.getElementById('lesson-cancel').addEventListener('click', closeModal);
  document.getElementById('modal-backdrop').addEventListener('click', e => { if (e.target.id === 'modal-backdrop') closeModal(); });
  document.getElementById('lesson-save').addEventListener('click', saveLessonFromModal);
  document.getElementById('lesson-delete').addEventListener('click', () => {
    if (!modalCtx || !modalCtx.editingId) return;
    if (!confirm('למחוק את השיבוץ הזה מכל הכיתות והמורים שבו?')) return;
    state.lessons = state.lessons.filter(l => l.id !== modalCtx.editingId);
    save(); closeModal(); renderAllBoards();
    toast('השיבוץ נמחק');
  });
  document.getElementById('copy-bar-end').addEventListener('click', endCopyMode);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeModal(); endCopyMode(); } });
}

init();
