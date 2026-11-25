// Formats IOF XML (2.0.3 et 3.0) : import des circuits et des inscrits, export des résultats.
import { escapeHtml as x, todayIso } from '../core/util.js';
import { IOF_STATUS } from '../domain/results.js';

function parseXml(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error("Le fichier n'est pas un XML valide.");
  return doc;
}

const kids = (el, name) => (el ? [...el.children].filter((c) => c.localName === name) : []);
const kid = (el, name) => kids(el, name)[0] || null;
const txt = (el, name) => kid(el, name)?.textContent.trim() || '';
const all = (root, name) => [...root.getElementsByTagNameNS('*', name)];

function toCode(s) {
  const n = Number(String(s).trim());
  return Number.isInteger(n) && n > 0 && n < 1024 ? n : null;
}

/**
 * Circuits exportés par OCAD, Purple Pen, Condes…
 * Renvoie { courses: [{name, length, climb, controls}], assignments: [{className, courseName}] }
 */
export function parseCourseData(text) {
  const doc = parseXml(text);
  const root = doc.documentElement;
  const courses = [];
  const assignments = [];
  const v3 = all(root, 'Course').some((c) => kid(c, 'Name') || kids(c, 'CourseControl').some((cc) => kid(cc, 'Control')));

  if (v3) {
    for (const c of all(root, 'Course')) {
      const name = txt(c, 'Name');
      if (!name) continue;
      const controls = [];
      for (const cc of kids(c, 'CourseControl')) {
        const type = cc.getAttribute('type') || 'Control';
        if (type !== 'Control') continue;
        const code = toCode(txt(cc, 'Control'));
        if (code != null) controls.push(code);
      }
      courses.push({ name, length: Number(txt(c, 'Length')) || 0, climb: Number(txt(c, 'Climb')) || 0, controls });
    }
    for (const a of all(root, 'ClassCourseAssignment')) {
      const className = txt(a, 'ClassName');
      const courseName = txt(a, 'CourseName');
      if (className && courseName) assignments.push({ className, courseName });
    }
  } else {
    // IOF 2.0.3
    for (const c of all(root, 'Course')) {
      const name = txt(c, 'CourseName');
      const variation = kid(c, 'CourseVariation');
      if (!name || !variation) continue;
      const ccs = kids(variation, 'CourseControl')
        .map((cc) => ({ seq: Number(txt(cc, 'Sequence')) || 0, code: toCode(txt(cc, 'ControlCode')) }))
        .filter((cc) => cc.code != null)
        .sort((a, b) => a.seq - b.seq);
      courses.push({
        name,
        length: Number(txt(variation, 'CourseLength')) || 0,
        climb: Number(txt(variation, 'CourseClimb')) || 0,
        controls: ccs.map((cc) => cc.code),
      });
      for (const cl of kids(c, 'ClassShortName')) {
        const className = cl.textContent.trim();
        if (className) assignments.push({ className, courseName: name });
      }
    }
  }
  if (!courses.length) throw new Error('Aucun circuit trouvé dans ce fichier (format IOF XML « CourseData » attendu).');
  return { courses, assignments };
}

function timeOfDay(iso) {
  const m = /T(\d{2}):(\d{2}):(\d{2})/.exec(iso || '');
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null;
}

/** Inscrits d'une EntryList ou StartList IOF 3.0. */
export function parseEntries(text) {
  const doc = parseXml(text);
  const root = doc.documentElement;
  const rows = [];
  const person = (el) => {
    const p = kid(el, 'Person');
    const n = kid(p, 'Name');
    const org = kid(el, 'Organisation');
    return {
      lastName: txt(n, 'Family'),
      firstName: txt(n, 'Given'),
      licence: txt(p, 'Id'),
      club: txt(org, 'Name') || txt(org, 'ShortName'),
    };
  };
  for (const e of all(root, 'PersonEntry')) {
    const cls = kid(e, 'Class');
    const card = txt(e, 'ControlCard').replace(/\D/g, '');
    rows.push({
      ...person(e),
      className: txt(cls, 'Name') || txt(cls, 'ShortName'),
      card: card ? Number(card) : null,
      bib: '',
      startTime: null,
      rented: false,
    });
  }
  for (const cs of all(root, 'ClassStart')) {
    const cls = kid(cs, 'Class');
    const className = txt(cls, 'Name') || txt(cls, 'ShortName');
    for (const ps of kids(cs, 'PersonStart')) {
      const st = kid(ps, 'Start');
      const card = txt(st, 'ControlCard').replace(/\D/g, '');
      rows.push({
        ...person(ps),
        className,
        card: card ? Number(card) : null,
        bib: txt(st, 'BibNumber'),
        startTime: timeOfDay(txt(st, 'StartTime')),
        rented: false,
      });
    }
  }
  if (!rows.length) throw new Error('Aucun coureur trouvé (format IOF XML 3.0 « EntryList » ou « StartList » attendu).');
  return rows;
}

const pad = (n) => String(n).padStart(2, '0');

function isoAt(date, seconds) {
  const d = new Date(`${date || todayIso()}T00:00:00`);
  d.setSeconds(Math.round(seconds));
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const a = Math.abs(off);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(
    d.getSeconds()
  )}${sign}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}

/** Résultats au format IOF XML 3.0 (ResultList), accepté par la plupart des sites de résultats. */
export function resultListXml(s, d) {
  const ev = s.event;
  const out = [];
  out.push('<?xml version="1.0" encoding="UTF-8"?>');
  out.push(
    `<ResultList xmlns="http://www.orienteering.org/datastandard/3.0" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" iofVersion="3.0" createTime="${isoAt(
      todayIso(),
      new Date().getHours() * 3600 + new Date().getMinutes() * 60 + new Date().getSeconds()
    )}" creator="CO - P3OPS" status="Snapshot">`
  );
  out.push(`  <Event><Name>${x(ev.name)}</Name>${ev.date ? `<StartTime><Date>${x(ev.date)}</Date></StartTime>` : ''}</Event>`);
  const classes = [...s.classes.values()].sort((a, b) => a.name.localeCompare(b.name, 'fr', { numeric: true }));
  for (const cls of classes) {
    const ranking = d.classes.get(cls.id);
    if (!ranking?.rows.length) continue;
    const course = s.courses.get(cls.courseId);
    out.push('  <ClassResult>');
    out.push(`    <Class><Name>${x(cls.name)}</Name></Class>`);
    if (course) {
      out.push(
        `    <Course><Name>${x(course.name)}</Name>${course.length ? `<Length>${Math.round(course.length)}</Length>` : ''}${
          course.climb ? `<Climb>${Math.round(course.climb)}</Climb>` : ''
        }</Course>`
      );
    }
    for (const row of ranking.rows) {
      const { comp, res } = row;
      if (res.status === 'RUN' && !comp.startTime) continue;
      out.push('    <PersonResult>');
      out.push(
        `      <Person>${comp.licence ? `<Id>${x(comp.licence)}</Id>` : ''}<Name><Family>${x(comp.lastName)}</Family><Given>${x(
          comp.firstName
        )}</Given></Name></Person>`
      );
      if (comp.club) out.push(`      <Organisation><Name>${x(comp.club)}</Name></Organisation>`);
      out.push('      <Result>');
      if (comp.bib) out.push(`        <BibNumber>${x(comp.bib)}</BibNumber>`);
      if (res.start != null) out.push(`        <StartTime>${isoAt(ev.date, res.start)}</StartTime>`);
      if (res.finish != null) out.push(`        <FinishTime>${isoAt(ev.date, res.finish)}</FinishTime>`);
      if (res.time != null) out.push(`        <Time>${Math.round(res.time)}</Time>`);
      if (row.place != null) {
        out.push(`        <TimeBehind>${Math.round(row.behind)}</TimeBehind>`);
        out.push(`        <Position>${row.place}</Position>`);
      }
      const status = res.status === 'OK' && comp.nc ? 'NotCompeting' : IOF_STATUS[res.status];
      out.push(`        <Status>${status}</Status>`);
      for (const sp of res.splits) {
        if (sp.missing || sp.cumul == null) out.push(`        <SplitTime status="Missing"><ControlCode>${sp.code}</ControlCode></SplitTime>`);
        else out.push(`        <SplitTime><ControlCode>${sp.code}</ControlCode><Time>${Math.round(sp.cumul)}</Time></SplitTime>`);
      }
      if (comp.card) out.push(`        <ControlCard>${x(comp.card)}</ControlCard>`);
      out.push('      </Result>');
      out.push('    </PersonResult>');
    }
    out.push('  </ClassResult>');
  }
  out.push('</ResultList>');
  return out.join('\n');
}
