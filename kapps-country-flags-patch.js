// Community patch for Kapps: country flags, Fastest Lap, Fuel Calculator rows, and a modern UI
// with a dark theme and Racing Overlay widget tabs (see README.md for the full list).
// Run with Kapps' own bundled Electron/Node runtime:
//   set ELECTRON_RUN_AS_NODE=1 & "<path-to-Kapps.exe>" kapps-country-flags-patch.js
// (or just double-click apply-country-flags-patch.bat next to this file)
process.noAsar = true;
const fs = require('fs');
const path = require('path');

function findAsar() {
  const explicit = process.argv[2];
  if (explicit) return explicit;
  const base = path.join(process.env.LOCALAPPDATA || '', 'kapps');
  if (!fs.existsSync(base)) throw new Error(`Could not find ${base}. Pass the app.asar path as an argument.`);
  const versionDirs = fs.readdirSync(base).filter((n) => /^app-\d/.test(n));
  if (!versionDirs.length) throw new Error(`No app-* folder found under ${base}.`);
  // Compare version numbers component-by-component as integers. A plain lexicographic sort
  // gets this wrong (it ranks 1.24.9 above 1.24.38, and 1.9.0 above 1.24.38) — which used to
  // be harmless because only one app-* folder ever existed, but Squirrel leaves the previous
  // version's folder in place after an update, so picking the right one now actually matters.
  const versionOf = (n) => n.slice(4).split('.').map((x) => parseInt(x, 10) || 0);
  versionDirs.sort((a, b) => {
    const [va, vb] = [versionOf(a), versionOf(b)];
    for (let i = 0; i < Math.max(va.length, vb.length); i++) {
      if ((va[i] || 0) !== (vb[i] || 0)) return (va[i] || 0) - (vb[i] || 0);
    }
    return 0;
  });
  const latest = versionDirs[versionDirs.length - 1];
  return path.join(base, latest, 'resources', 'app.asar');
}

function readAsar(asarPath) {
  const fd = fs.openSync(asarPath, 'r');
  const readU32 = (offset) => {
    const b = Buffer.alloc(4);
    fs.readSync(fd, b, 0, 4, offset);
    return b.readUInt32LE(0);
  };
  const outerPayloadSize = readU32(0);
  if (outerPayloadSize !== 4) throw new Error('Unrecognised asar header — not a standard Electron asar file.');
  const M = readU32(8);
  const L = readU32(12);
  const jsonBuf = Buffer.alloc(L);
  fs.readSync(fd, jsonBuf, 0, L, 16);
  const header = JSON.parse(jsonBuf.toString('utf8'));
  const paddedL = Math.ceil(L / 4) * 4;
  const dataStart = 16 + paddedL;

  const files = {}; // relPath -> Buffer
  function walk(node, relPath) {
    if (node.files) {
      for (const name of Object.keys(node.files)) walk(node.files[name], path.posix.join(relPath, name));
      return;
    }
    if (node.unpacked) return;
    const size = parseInt(node.size, 10);
    const offset = parseInt(node.offset, 10);
    const buf = Buffer.alloc(size);
    if (size > 0) fs.readSync(fd, buf, 0, size, dataStart + offset);
    files[relPath] = buf;
  }
  walk(header, '');
  fs.closeSync(fd);
  return { header, files };
}

function writeAsar(header, files, outPath) {
  const chunks = [];
  let runningOffset = 0;
  function walk(node, relPath) {
    if (node.files) {
      for (const name of Object.keys(node.files)) walk(node.files[name], path.posix.join(relPath, name));
      return;
    }
    if (node.unpacked) return;
    const buf = files[relPath];
    if (!buf) throw new Error(`Missing file data for ${relPath}`);
    node.size = buf.length;
    node.offset = String(runningOffset);
    delete node.integrity;
    runningOffset += buf.length;
    chunks.push(buf);
  }
  walk(header, '');

  const jsonBuf = Buffer.from(JSON.stringify(header), 'utf8');
  const L = jsonBuf.length;
  const paddedL = Math.ceil(L / 4) * 4;
  const jsonPadded = Buffer.concat([jsonBuf, Buffer.alloc(paddedL - L)]);
  const M = 4 + paddedL;
  const header2 = Buffer.alloc(4 + M);
  header2.writeUInt32LE(M, 0);
  header2.writeUInt32LE(L, 4);
  jsonPadded.copy(header2, 8);
  const outer = Buffer.alloc(8);
  outer.writeUInt32LE(4, 0);
  outer.writeUInt32LE(header2.length, 4);
  fs.writeFileSync(outPath, Buffer.concat([outer, header2, ...chunks]));
}

function mustReplace(str, from, to, label) {
  const count = str.split(from).length - 1;
  if (count !== 1) {
    throw new Error(
      `Expected exactly one occurrence of the ${label} anchor text, found ${count}. ` +
      `This Kapps version's code doesn't match what this patch expects — aborting without changing anything.`
    );
  }
  return str.split(from).join(to);
}

// For stock code read rather than replaced: the one match of `re`, or an error like mustReplace's.
function mustMatch(str, re, label) {
  const found = str.match(new RegExp(re.source, 'g')) || [];
  if (found.length !== 1) {
    throw new Error(
      `Expected exactly one match of the ${label} pattern, found ${found.length}. ` +
      `This Kapps version's code doesn't match what this patch expects — aborting without changing anything.`
    );
  }
  return str.match(re);
}

// mustReplace for anchor text that legitimately appears `count` times.
function mustReplaceAll(str, from, to, count, label) {
  const found = str.split(from).length - 1;
  if (found !== count) {
    throw new Error(
      `Expected ${count} occurrences of the ${label} anchor text, found ${found}. ` +
      `This Kapps version's code doesn't match what this patch expects — aborting without changing anything.`
    );
  }
  return str.split(from).join(to);
}

const FLAIR_MAP =
  '{3:"af",4:"ax",5:"al",6:"dz",7:"as",8:"ad",9:"ao",10:"ai",11:"aq",12:"ag",13:"ar",14:"am",15:"aw",16:"au",17:"at",18:"az",19:"bs",20:"bh",21:"bd",22:"bb",23:"be",24:"bz",25:"bj",26:"bm",27:"bt",28:"bo",29:"ba",30:"bw",31:"br",32:"vg",33:"bn",34:"bg",35:"bf",36:"bi",37:"kh",38:"cm",39:"ca",40:"cv",41:"ky",42:"cf",43:"td",44:"cl",45:"cn",46:"cx",47:"cc",48:"co",49:"km",50:"ck",51:"cr",52:"hr",53:"cy",54:"cz",55:"cd",56:"dk",57:"dj",58:"dm",59:"do",60:"ec",61:"eg",62:"sv",63:"gq",64:"er",65:"ee",66:"et",67:"fk",68:"fo",69:"fj",70:"fi",71:"fr",72:"gf",73:"pf",74:"ga",75:"gm",76:"ge",77:"de",78:"gh",79:"gi",80:"gr",81:"gl",82:"gd",83:"gp",84:"gu",85:"gt",86:"gg",87:"gn",88:"gw",89:"gy",90:"ht",91:"hn",92:"hk",93:"hu",94:"is",95:"in",96:"id",97:"iq",98:"ie",99:"im",100:"il",101:"it",102:"ci",103:"jm",104:"jp",105:"je",106:"jo",107:"kz",108:"ke",109:"ki",110:"kw",111:"kg",112:"la",113:"lv",114:"lb",115:"ls",116:"lr",117:"ly",118:"li",119:"lt",120:"lu",121:"mo",122:"mk",123:"mg",124:"mw",125:"my",126:"mv",127:"ml",128:"mt",129:"mh",130:"mq",131:"mr",132:"mu",133:"yt",134:"mx",135:"fm",136:"md",137:"mc",138:"mn",139:"me",140:"ms",141:"ma",142:"mz",143:"na",144:"nr",145:"np",146:"nl",148:"nc",149:"nz",150:"ni",151:"ne",152:"ng",153:"nu",154:"nf",155:"mp",156:"no",157:"om",158:"pk",159:"pw",160:"ps",161:"pa",162:"pg",163:"py",164:"pe",165:"ph",166:"pn",167:"pl",168:"pt",169:"pr",170:"qa",171:"cg",172:"re",173:"ro",174:"rw",175:"sh",176:"kn",177:"lc",178:"pm",179:"vc",180:"bl",181:"mf",182:"ws",183:"sm",184:"st",185:"sa",186:"sn",187:"rs",188:"sc",189:"sl",190:"sg",191:"sk",192:"si",193:"sb",194:"so",195:"za",196:"gs",197:"kr",198:"es",199:"lk",200:"sr",201:"sj",202:"sz",203:"se",204:"ch",205:"tw",206:"tj",207:"tz",208:"th",209:"tl",210:"tg",211:"tk",212:"to",213:"tt",214:"tn",215:"tr",216:"tm",217:"tc",218:"tv",219:"ug",220:"ua",221:"ae",222:"gb",223:"us",224:"uy",225:"uz",226:"vu",227:"va",228:"ve",229:"vn",230:"vi",231:"wf",232:"eh",233:"ye",234:"zm",235:"zw",236:"gb-eng",237:"gb-sct",238:"gb-wls",239:"gb-nir",240:"bq",241:"cw",242:"sx"}';

const GLOBE_ICON_DATA_URI =
  'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxNiAxMiI+PHJlY3Qgd2lkdGg9IjE2IiBoZWlnaHQ9IjEyIiByeD0iMSIgZmlsbD0iIzJmNmZlZCIvPjxjaXJjbGUgY3g9IjgiIGN5PSI2IiByPSI0LjIiIGZpbGw9Im5vbmUiIHN0cm9rZT0iI2ZmZiIgc3Ryb2tlLXdpZHRoPSIwLjgiLz48cGF0aCBkPSJNOCAxLjh2OC40TTQuMyA2aDcuNE01LjMgMy4zYzEuNiAxLjggNC44IDEuOCA2LjQgME01LjMgOC43YzEuNi0xLjggNC44LTEuOCA2LjQgMCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjZmZmIiBzdHJva2Utd2lkdGg9IjAuNiIvPjwvc3ZnPg==';

// Small preview flag used only for the settings-editor drag-and-drop chip (plain, unrotated).
const CHIP_FLAG_DATA_URI =
  'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA2MCAzMCI+PHJlY3Qgd2lkdGg9IjYwIiBoZWlnaHQ9IjMwIiBmaWxsPSIjQjIyMjM0Ii8+PHJlY3QgeT0iMi4zMSIgd2lkdGg9IjYwIiBoZWlnaHQ9IjIuMzEiIGZpbGw9IiNmZmYiLz48cmVjdCB5PSI2LjkyIiB3aWR0aD0iNjAiIGhlaWdodD0iMi4zMSIgZmlsbD0iI2ZmZiIvPjxyZWN0IHk9IjExLjU0IiB3aWR0aD0iNjAiIGhlaWdodD0iMi4zMSIgZmlsbD0iI2ZmZiIvPjxyZWN0IHk9IjE2LjE1IiB3aWR0aD0iNjAiIGhlaWdodD0iMi4zMSIgZmlsbD0iI2ZmZiIvPjxyZWN0IHk9IjIwLjc3IiB3aWR0aD0iNjAiIGhlaWdodD0iMi4zMSIgZmlsbD0iI2ZmZiIvPjxyZWN0IHk9IjI1LjM4IiB3aWR0aD0iNjAiIGhlaWdodD0iMi4zMSIgZmlsbD0iI2ZmZiIvPjxyZWN0IHdpZHRoPSIyNCIgaGVpZ2h0PSIxNi4xNSIgZmlsbD0iIzNDM0I2RSIvPjwvc3ZnPg==';

const OLD_DEFAULT_COLUMNS = '"gain","car-number","name","car-manufacture","ratings","gap","int","lap-time","tyre-compound","joker","pit","gain-history"';
const NEW_DEFAULT_COLUMNS = '"gain","car-number","name","country-flag","car-manufacture","ratings","gap","int","lap-time","tyre-compound","joker","pit","gain-history"';

function patchDefaultColumns(src, label) {
  return mustReplace(src, OLD_DEFAULT_COLUMNS, NEW_DEFAULT_COLUMNS, label + ' default columns');
}

function patchWorker(src) {
  src = mustReplace(
    src,
    '"classIndex","position","gain","carNumber","name","carManufacture","srating"',
    '"classIndex","position","gain","carNumber","name","countryFlag","carManufacture","srating"',
    'worker.js mainKeys'
  );
  src = mustReplace(
    src,
    'n.driverInfo=e,n.name={}',
    `n.driverInfo=e,n.countryFlag=(${FLAIR_MAP})[e.FlairID]||"global",n.name={}`,
    'worker.js driver-mapping'
  );
  src = patchDefaultColumns(src, 'worker.js');
  return src;
}

function patchStandingsJs(src) {
  src = mustReplace(
    src,
    'r.classList.toggle("hidden",null==I)),this.dataContentEls.has("srating")',
    `r.classList.toggle("hidden",null==I)),this.dataContentEls.has("countryFlag")&&this.data._apply.countryFlag&&([I,C,r]=this.getApplyData("countryFlag"),r.classList.toggle("hidden",!I),I&&(r.src="global"===I?"${GLOBE_ICON_DATA_URI}":\`https://flagcdn.com/16x12/${'$'}{I}.png\`)),this.dataContentEls.has("srating")`,
    'standings.js apply()'
  );
  src = patchDefaultColumns(src, 'standings.js');
  // Same defensive injection as settings.js: make sure "country-flag" is always present in
  // whatever driver.columns array gets loaded (persisted settings predating this feature won't
  // have it), before the template-pruning step decides which column elements survive. Not in LMU
  // overlays (settings.lmu), which have no nationality to show.
  src = mustReplace(
    src,
    '})(this.headerTemplate,i.settings.header.columns,["class-border","session-type","bg"]),t(this.driverTemplate,i.settings.driver.columns,["position"])',
    '})(this.headerTemplate,i.settings.header.columns,["class-border","session-type","bg"]),i.settings.lmu||i.settings.driver.columns.includes("country-flag")||i.settings.driver.columns.splice(i.settings.driver.columns.indexOf("name")+1,0,"country-flag"),t(this.driverTemplate,i.settings.driver.columns,["position"])',
    'standings.js template-pruning country-flag injection'
  );
  return src;
}

function patchIndexHtml(src) {
  return mustReplace(
    src,
    '\t\t\t\t<div class="name">\r\n\t\t\t\t\t<div class="content serif" data-column="name">',
    '\t\t\t\t<div class="country-flag">\r\n\t\t\t\t\t<img class="content hidden" data-column="country-flag" data-content="countryFlag" onerror="this.classList.add(\'hidden\')" />\r\n\t\t\t\t</div>\r\n\t\t\t\t<div class="name">\r\n\t\t\t\t\t<div class="content serif" data-column="name">',
    'index.html name column'
  );
}

function patchStandingsCss(src) {
  const rule = '.rows > .row.driver > .wrap > div.country-flag{width:var(--column-width-country-flag);align-items:center}body > .rows > .row.driver > .wrap > div.country-flag > .content{width:16px;height:12px;object-fit:cover;border-radius:1px}';
  if (src.includes(rule)) throw new Error('standings.css already contains the country-flag rule — patch already applied?');
  return src + rule;
}

function patchSettingsJs(src) {
  // 1) Flat {className,name,width} registry used for the chip's initial metadata (the per-preset
  //    width table is patchStandingsSizing's).
  src = mustReplace(
    src,
    '{"className":"car-manufacture","name":"carManufacture","width":35}',
    '{"className":"country-flag","name":"countryFlag","width":25},{"className":"car-manufacture","name":"carManufacture","width":35}',
    'settings.js flat column registry'
  );

  // 2) Ensure "country-flag" gets injected into whatever driver.columns array is loaded
  //    (persisted settings won't know about it), BEFORE the chip placement decision runs —
  //    doing this too late leaves the chip stuck in the "available" drop area.
  src = mustReplace(
    src,
    'for(He=a[Be],Ne=document.querySelectorAll(`.row.${Be}`)',
    'for(("driver"!==Be||this.data.lmu||this.data[Be].columns.includes("country-flag")||this.data[Be].columns.splice(this.data[Be].columns.indexOf("name")+1,0,"country-flag")),He=a[Be],Ne=document.querySelectorAll(`.row.${Be}`)',
    'settings.js early column injection'
  );

  // 3) A second, later pass re-appends columns in driver.columns order to fix drag-drop
  //    ordering — needs the same defensive injection or a persisted settings array without
  //    "country-flag" leaves it un-reordered here too.
  src = mustReplace(
    src,
    'Pe.setInstances(Ae),se=0,F=(ce=this.data[Be].columns).length',
    'Pe.setInstances(Ae),("driver"!==Be||this.data.lmu||this.data[Be].columns.includes("country-flag")||this.data[Be].columns.splice(this.data[Be].columns.indexOf("name")+1,0,"country-flag")),se=0,F=(ce=this.data[Be].columns).length',
    'settings.js late column injection'
  );

  return src;
}

function patchSettingsCss(src) {
  const rule = `.atlas.driver.country-flag{width:25px;height:25px;background-color:#000;background-image:url(${CHIP_FLAG_DATA_URI});background-size:20px 10px;background-repeat:no-repeat;background-position:center;border-radius:2px}`;
  if (src.includes(rule)) throw new Error('settings.css already contains the country-flag chip rule — patch already applied?');
  return src + rule;
}

// --- Standings Fastest Lap column ----------------------------------------------------------
// Adds a session-best-lap column to Standings, addable/removable via the same drag-and-drop
// editor as every other column. Mirrors lapTime's own registration surface closely, since it
// shares the same P&Q/Race precision popup and width-measurement machinery.
function patchWorkerFastestLap(src) {
  src = mustReplace(
    src,
    '"isPBLapTime","isBestLapTime","tyreCompound","joker","gainHistory"',
    '"isPBLapTime","isBestLapTime","fastestLap","tyreCompound","joker","gainHistory"',
    'worker.js mainKeys fastestLap'
  );
  src = mustReplace(
    src,
    'i.isBestLapTime=null,i.tyreCompound=null',
    'i.isBestLapTime=null,i.fastestLap=null,i.tyreCompound=null',
    'worker.js reset fastestLap'
  );
  // lapTime/gap/int are computed independently across three session-state branches (Race,
  // a shared Qualify+Practice branch, and an early-race fallback branch), each reading from a
  // different source field — fastestLap needs adding to all three or it silently never
  // populates outside of Race sessions.
  src = mustReplace(
    src,
    'l.lapTime=u?.001*(1e3*B.LastTime|0):null,B.LapsComplete>1&&(g=B.FastestLap===B.LapsComplete)',
    'l.lapTime=u?.001*(1e3*B.LastTime|0):null,l.fastestLap=B.FastestTime>0?.001*(1e3*B.FastestTime|0):null,B.LapsComplete>1&&(g=B.FastestLap===B.LapsComplete)',
    'worker.js race-branch fastestLap'
  );
  src = mustReplace(
    src,
    's&&u&&(l.lapTime=.001*(1e3*B.Time|0))),l.gapData.ppq=B,E.set(a,n))',
    's&&u&&(l.lapTime=.001*(1e3*B.Time|0),l.fastestLap=B.FastestTime>0?.001*(1e3*B.FastestTime|0):null)),l.gapData.ppq=B,E.set(a,n))',
    'worker.js qualify/practice-branch fastestLap'
  );
  src = mustReplace(
    src,
    'l.lapTime=o>0?o:null,C.WeekendInfo.HeatRacing',
    'l.lapTime=o>0?o:null,l.fastestLap=B.FastestTime>0?.001*(1e3*B.FastestTime|0):null,C.WeekendInfo.HeatRacing',
    'worker.js early-race-branch fastestLap'
  );
  return src;
}

function patchStandingsJsFastestLap(src) {
  // standings.js loads its own settings independently of settings.js (Object.assign against
  // defaultSettings + a shallow merge of a URL-param override) — needs its own backfill so an
  // existing user's saved override (which predates this column) doesn't leave it undefined.
  src = mustReplace(
    src,
    'this.settings=Object.assign({},a.defaultSettings.settings),this.params.settings&&n(this.settings,JSON.parse(this.params.settings)),this.font=r.getById(this.settings.font)',
    'this.settings=Object.assign({},a.defaultSettings.settings),this.params.settings&&n(this.settings,JSON.parse(this.params.settings)),null==this.settings.driver.fastestLap&&(this.settings.driver.fastestLap=a.defaultSettings.settings.driver.fastestLap),this.font=r.getById(this.settings.font)',
    'standings.js settings.driver.fastestLap backfill'
  );
  // Format the raw value into the hidden "fake" element, same pattern as lapTime. Also hide
  // the value (same "hidden" toggle other conditionally-shown columns use) when the user has
  // "Hide in P&Q" on and the CURRENT column is in its "pandq" precision bucket — reusing the
  // exact same bucket (`_`, just computed above for the precision lookup) rather than a
  // separate per-driver fact, since "Practice + every Qualify type" IS that bucket.
  src = mustReplace(
    src,
    'this.dataContentEls.has("lapTime")&&this.data._apply.lapTime&&([I,C,r]=this.getApplyData("lapTime"),null!=I?(_=h.sessionData.isRaceStarted?"race":"pandq",x=function(){if(I>=599.95)return 1;switch(l.settings.driver.lapTime[_].precision){case"fractions-3":return 3;case"fractions-2":return 2;case"fractions-1":return 1}}(),r.textContent=p(I,x)):r.textContent="",r.classList.toggle("hidden",null==I)),this.dataContentEls.has("tyreCompound")',
    'this.dataContentEls.has("lapTime")&&this.data._apply.lapTime&&([I,C,r]=this.getApplyData("lapTime"),null!=I?(_=h.sessionData.isRaceStarted?"race":"pandq",x=function(){if(I>=599.95)return 1;switch(l.settings.driver.lapTime[_].precision){case"fractions-3":return 3;case"fractions-2":return 2;case"fractions-1":return 1}}(),r.textContent=p(I,x)):r.textContent="",r.classList.toggle("hidden",null==I)),this.dataContentEls.has("fastestLap")&&this.data._apply.fastestLap&&([I,C,r]=this.getApplyData("fastestLap"),null!=I?(_=h.sessionData.isRaceStarted?"race":"pandq",x=function(){if(I>=599.95)return 1;switch((l.settings.driver.fastestLap&&l.settings.driver.fastestLap[_]&&l.settings.driver.fastestLap[_].precision)||"fractions-3"){case"fractions-3":return 3;case"fractions-2":return 2;case"fractions-1":return 1}}(),r.textContent=p(I,x)):r.textContent="",r.classList.toggle("hidden",null==I||"pandq"===_&&l.settings.driver.fastestLap&&l.settings.driver.fastestLap.hideInPQ)),this.dataContentEls.has("tyreCompound")',
    'standings.js apply-block fastestLap'
  );
  // Reveal step: copies the formatted text from the hidden "fake" element into the visible
  // "real" sibling. Every column needing this has its own dedicated revealXXX(), dispatched
  // from revealAll() — a bare data pipeline with no reveal step just never displays anything.
  // The purple "fastest lap" fill is a separate reveal step keyed off this.style.bestLapTime —
  // gate it too, so a hidden-in-P&Q cell doesn't show an empty purple box. No `_` in scope
  // here (separate method), so derive pandq/race the same way the apply-step originally does.
  src = mustReplace(
    src,
    'this.dataContentEls.has("lapTime")&&this.revealLapTime(),',
    'this.dataContentEls.has("lapTime")&&this.revealLapTime(),this.dataContentEls.has("fastestLap")&&this.revealFastestLap(),',
    'standings.js revealAll dispatcher fastestLap'
  );
  src = mustReplace(
    src,
    'async revealTyreCompound(){',
    'async revealFastestLap(){if(this.data._reveal.fastestLap){var e=this.dataContentEls.get("fastestLap");e.nextElementSibling.textContent=e.textContent}this.data._reveal.isBestLapTime&&(this.style.bestLapTime=this.data.isBestLapTime&&!(!h.sessionData.isRaceStarted&&l.settings.driver.fastestLap&&l.settings.driver.fastestLap.hideInPQ))}async revealTyreCompound(){',
    'standings.js revealFastestLap definition'
  );
  // standings.js carries its OWN independent copy of the widget's defaultSettings (same
  // shared-registry duplication pattern as everywhere else in this file) — separate from
  // settings.js's copy, patched above. Missing this is what caused fastestLap to silently
  // stay undefined specifically once isRaceStarted flips true (switching the precision lookup
  // from "pandq" to "race" mode) during an actual Race session — Practice/Qualify testing
  // never exercised that branch, so this went unnoticed until a live race.
  src = mustReplace(
    src,
    'lapTime:{pandq:{precision:"fractions-3"},race:{precision:"fractions-1"}},pit:{style:"pit-time"}',
    'lapTime:{pandq:{precision:"fractions-3"},race:{precision:"fractions-1"}},fastestLap:{pandq:{precision:"fractions-3"},race:{precision:"fractions-1"},hideInPQ:!1},pit:{style:"pit-time"}',
    'standings.js fastestLap defaultSettings'
  );
  return src;
}

function patchIndexHtmlFastestLap(src) {
  // Each column has a hidden "fake" element (used only for layout/width measurement) and a
  // separate "real" element the actual live text gets written into — a column with only the
  // fake element has structurally nowhere for its value to ever render.
  return mustReplace(
    src,
    '\t\t\t\t</div>\r\n\t\t\t\t<div class="tyre-compound">',
    '\t\t\t\t</div>\r\n\t\t\t\t<div class="fastest-lap">\r\n\t\t\t\t\t<div class="content mono fake hidden" data-column="fastest-lap" data-content="fastestLap"></div>\r\n\t\t\t\t\t<div class="content mono real"></div>\r\n\t\t\t\t</div>\r\n\t\t\t\t<div class="tyre-compound">',
    'index.html fastest-lap column'
  );
}

function patchStandingsCssFastestLap(src) {
  // The fake/real elements need position:absolute (fake also gets visibility:hidden) so the
  // hidden one can be measured via getBoundingClientRect() without affecting layout — without
  // this the column measures as a 0-width sliver.
  //
  // Highlight color: a solid purple fill, shown ONLY on the "best-lap-time" row class — the
  // same per-CLASS "who holds the fastest lap in their own class" flag (isBestLapTime, already
  // computed in worker.js by comparing FastestTime only against same-CarClassID rivals) that
  // drives Last Lap Time's own "purple lap" indicator. A gradient/underline treatment matching
  // Last Lap's exact visual was tried first, but its radial-gradient falloff reads much weaker
  // on Fastest Lap's narrower column, so a plain solid fill was used instead for reliable
  // visibility regardless of column width or the user's configured background opacity.
  const rule =
    '.rows > .row.driver > .wrap > div.fastest-lap{width:var(--column-width-fastest-lap);justify-content:flex-end}' +
    '.rows > .row.driver > .wrap > div.fastest-lap > .fake{position:absolute;visibility:hidden}' +
    '.rows > .row.driver > .wrap > div.fastest-lap > .real{position:absolute}' +
    '.rows > .row.driver.best-lap-time > .wrap > div.fastest-lap{background-color:#a020f0;border-radius:3px}' +
    '.rows.animate > .row.driver > .wrap > div.fastest-lap{transition:var(--transition-duration) background-color ease-out}';
  if (src.includes(rule)) throw new Error('standings.css already contains the fastest-lap rule — patch already applied?');
  return src + rule;
}

function patchSettingsJsFastestLap(src) {
  // 1) Flat {className,name,options} registry entry — same precision sub-options/widths as
  //    lap-time, since fastest lap uses the identical text format.
  src = mustReplace(
    src,
    '{"className":"lap-time","name":"lapTime","options":[{"className":["precision"],"name":["precision"],"options":[{"className":["precision-fractions-3"],"option":["fractions-3"],"width":80},{"className":["precision-fractions-2"],"option":["fractions-2"],"width":71},{"className":["precision-fractions-1"],"option":["fractions-1"],"width":63}]}]}',
    '{"className":"lap-time","name":"lapTime","options":[{"className":["precision"],"name":["precision"],"options":[{"className":["precision-fractions-3"],"option":["fractions-3"],"width":80},{"className":["precision-fractions-2"],"option":["fractions-2"],"width":71},{"className":["precision-fractions-1"],"option":["fractions-1"],"width":63}]}]},{"className":"fastest-lap","name":"fastestLap","options":[{"className":["precision"],"name":["precision"],"options":[{"className":["precision-fractions-3"],"option":["fractions-3"],"width":80},{"className":["precision-fractions-2"],"option":["fractions-2"],"width":71},{"className":["precision-fractions-1"],"option":["fractions-1"],"width":63}]}]}',
    'settings.js flat registry fastest-lap'
  );

  // 2) Precision-options map — drives the actual hover-popup contents, distinct from the width
  //    table (see patchStandingsSizing). Without this, createOptionContentPQR reads undefined.precision and throws,
  //    blanking the entire settings editor before it paints anything.
  src = mustReplace(
    src,
    'lapTime:{precision:[{id:"fractions-3"},{id:"fractions-2"},{id:"fractions-1"}]},pit:{style:',
    'lapTime:{precision:[{id:"fractions-3"},{id:"fractions-2"},{id:"fractions-1"}]},fastestLap:{precision:[{id:"fractions-3"},{id:"fractions-2"},{id:"fractions-1"}]},pit:{style:',
    'settings.js precision-options map fastestLap'
  );

  // 3) The P&Q/Race precision popup UI is a hardcoded switch(columnName). fastestLap gets its
  //    own case (not a fall-through from lapTime) so it can carry an extra "Hide in P&Q"
  //    checkbox that Last Lap Time has no equivalent need for — bound to
  //    driver.fastestLap.hideInPQ via the same for-in/assignDataBind idiom the tyreCompound
  //    "Always On" checkbox above already uses. "Hide in P&Q" hides the column for BOTH
  //    Practice and every Qualify type (not Practice alone) — deliberately reusing the app's
  //    own "p&q" precision bucket rather than distinguishing Practice from Qualify.
  src = mustReplace(
    src,
    'case"lapTime":(v=document.createElement("div")).classList.add("options",Be,M.className),te=this.createOptionContentPQR(b,Be,M,M,"pandq","precision"),(S=v.appendChild(document.createElement("header"))).textContent="p&q",te.prepend(S),v.appendChild(te),te=this.createOptionContentPQR(b,Be,M,M,"race","precision"),(S=v.appendChild(document.createElement("header"))).textContent="race",te.prepend(S),v.appendChild(te);break',
    'case"lapTime":(v=document.createElement("div")).classList.add("options",Be,M.className),te=this.createOptionContentPQR(b,Be,M,M,"pandq","precision"),(S=v.appendChild(document.createElement("header"))).textContent="p&q",te.prepend(S),v.appendChild(te),te=this.createOptionContentPQR(b,Be,M,M,"race","precision"),(S=v.appendChild(document.createElement("header"))).textContent="race",te.prepend(S),v.appendChild(te);break;case"fastestLap":(v=document.createElement("div")).classList.add("options",Be,M.className),te=this.createOptionContentPQR(b,Be,M,M,"pandq","precision"),(S=v.appendChild(document.createElement("header"))).textContent="p&q",te.prepend(S),v.appendChild(te),te=this.createOptionContentPQR(b,Be,M,M,"race","precision"),(S=v.appendChild(document.createElement("header"))).textContent="race",te.prepend(S),v.appendChild(te);for(t in(te=v.appendChild(document.createElement("div"))).classList.add("form"),E=te.appendChild(document.createElement("input")),Re={type:"checkbox",id:k=`${Be}.${M.name}.hideInPQ`,"data-bind":k})n=Re[t],E.setAttribute(t,n);(L=te.appendChild(document.createElement("label"))).textContent="Hide in P&Q",L.htmlFor=E.id,this.assignDataBind(E);break',
    'settings.js fastestLap popup case + hideInPQ checkbox'
  );

  // 4) defaultSettings entry.
  src = mustReplace(
    src,
    'lapTime:{pandq:{precision:"fractions-3"},race:{precision:"fractions-1"}},pit:{style:"pit-time"}',
    'lapTime:{pandq:{precision:"fractions-3"},race:{precision:"fractions-1"}},fastestLap:{pandq:{precision:"fractions-3"},race:{precision:"fractions-1"},hideInPQ:!1},pit:{style:"pit-time"}',
    'settings.js fastestLap defaultSettings'
  );

  // 5) Backfill this.data.driver.fastestLap for existing users whose saved settings predate
  //    this column — the chip-generation loop reads this.data.driver.fastestLap.precision
  //    unconditionally for any column with precision sub-options, and a genuinely-undefined
  //    (not just missing-key) parent object throws there, blanking the whole editor.
  src = mustReplace(
    src,
    'null==(l=this.data.colors).bgLightness&&(l.bgLightness=this.defaultSettings.colors.bgLightness),De={header:',
    'null==(l=this.data.colors).bgLightness&&(l.bgLightness=this.defaultSettings.colors.bgLightness),null==this.data.driver.fastestLap&&(this.data.driver.fastestLap=JSON.parse(JSON.stringify(this.defaultSettings.driver.fastestLap))),De={header:',
    'settings.js constructor fastestLap data backfill'
  );

  // 6) getBoundsBySettings does its own independent shallow settings merge (used to size the
  //    Preview panel) — needs the same backfill or it throws mid-render and Preview stays blank.
  src = mustReplace(
    src,
    'p=(N=s.getById("standings2")).defaultSettings.settings,e=o({},p,e),t={width:{header:0,driver:{pandq:0,race:0}},height:0},u=a(e.font,e.condensed,e.header.size)',
    'p=(N=s.getById("standings2")).defaultSettings.settings,e=o({},p,e),null==e.driver.fastestLap&&(e.driver.fastestLap=p.driver.fastestLap),t={width:{header:0,driver:{pandq:0,race:0}},height:0},u=a(e.font,e.condensed,e.header.size)',
    'settings.js getBoundsBySettings fastestLap backfill'
  );

  // 7) Width-SUM calculation (separate from the width table, which patchStandingsSizing extends) needs fastest-lap added
  //    alongside lap-time or it silently uses the wrong (non-precision-aware) lookup path.
  src = mustReplace(
    src,
    'case"gap":case"int":case"lap-time":return w(I,P,h,A);case"name":',
    'case"gap":case"int":case"lap-time":case"fastest-lap":return w(I,P,h,A);case"name":',
    'settings.js width-calc switch fastest-lap'
  );

  return src;
}

function patchSettingsCssFastestLap(src) {
  // The chip-picker's "atlas" class sizes/backgrounds each column from a shared sprite sheet,
  // keyed by className + precision variant — reusing lap-time's exact crop so it's visually
  // identical to it, then tinting purple (blend-mode, since the sprite crop is opaque and a
  // plain background-color would sit invisibly behind it) to distinguish the two at a glance.
  const atlasRule = '.atlas.driver.fastest-lap.precision-fractions-3{width:80px;height:25px;background-position:-347px -500px}.atlas.driver.fastest-lap.precision-fractions-2{width:71px;height:25px;background-position:-427px -500px}.atlas.driver.fastest-lap.precision-fractions-1{width:63px;height:25px;background-position:0 -525px}.atlas.driver.fastest-lap{background-color:#8b3ef2;background-blend-mode:multiply}';
  if (src.includes(atlasRule)) throw new Error('settings.css already contains the fastest-lap atlas rule — patch already applied?');
  src += atlasRule;

  // The P&Q/Race precision popup itself had no .options.driver.fastest-lap layout rule at
  // all, so without this it falls back to default block stacking (P&Q above RACE) instead of
  // matching Last Lap Time's side-by-side P&Q | RACE columns. Mirrors lap-time's own rules,
  // then adds a rule so the "Hide in P&Q" checkbox (a 3rd direct child of the same flex
  // container) wraps onto its own full-width row below both columns, left-aligned under P&Q.
  const layoutRule =
    '.options.driver.fastest-lap{display:flex;flex-wrap:wrap;gap:10px}' +
    '.options.driver.fastest-lap>.precision{display:flex;flex-direction:column;gap:2px}' +
    '.options.driver.fastest-lap>.form{flex-basis:100%;justify-content:flex-start;margin-top:4px}';
  if (src.includes(layoutRule)) throw new Error('settings.css already contains the fastest-lap popup layout rule — patch already applied?');
  return src + layoutRule;
}

// --- Fuel Calculator target laps -----------------------------------------------------------
// Adds a "target laps" row to the Fuel Calculator overlay, showing the fuel-per-lap needed for
// the laps immediately around the driver's current average-pace target (floor(fuelLevel/usage)
// ± 1), mirroring irdashies' useFuelCalculation.tsx. Toggle placed above "Custom" in settings.
function patchTargetLapsSharedSettings(src, label) {
  // Same shared-registry duplication pattern as country-flag/relatives above — every widget
  // bundle carries its own copy of Fuel Calculator's defaultSettings/urlKeys regardless of
  // whether that specific widget uses them. app.js embeds this registry more than once
  // (settings-page's own copy plus the widget-registry copy), hence "at least 1" not "exactly 1".
  const A_from = 'showQualy:!0,showLast:!1,showCustom:!1,showClock:!1,clockStyle:"24",hideClockWhenInMulticlass:!0';
  const A_to = 'showQualy:!0,showLast:!1,showTargetLaps:!1,showCustom:!1,showClock:!1,clockStyle:"24",hideClockWhenInMulticlass:!0';
  const B_from = '"showQualy","showLast","showCustom","showClock","clockStyle","hideClockWhenInMulticlass"';
  const B_to = '"showQualy","showLast","showTargetLaps","showCustom","showClock","clockStyle","hideClockWhenInMulticlass"';

  const countA = src.split(A_from).length - 1;
  if (countA < 1) throw new Error(`Expected at least 1 occurrence of the ${label} fuelCalc defaultSettings anchor, found 0. This Kapps version's code doesn't match what this patch expects — aborting without changing anything.`);
  src = src.split(A_from).join(A_to);

  const countB = src.split(B_from).length - 1;
  if (countB < 1) throw new Error(`Expected at least 1 occurrence of the ${label} fuelCalc urlKeys anchor, found 0. This Kapps version's code doesn't match what this patch expects — aborting without changing anything.`);
  src = src.split(B_from).join(B_to);

  return src;
}

function patchFuelCalcJs(src) {
  // Target-lap scenarios, mirroring irdashies' useFuelCalculation.tsx: currentLapTarget =
  // floor(fuelLevel/avgUsage); show that lap plus one on either side, each with its own
  // fuel-per-lap requirement.
  src = mustReplace(
    src,
    'scope.remainAvg=curFuelLevel/scope.usageAvg,null!=scope.usageQualy&&(scope.remainQualy=curFuelLevel/scope.usageQualy)',
    'scope.remainAvg=curFuelLevel/scope.usageAvg,(function(fl,ua){if(ua>0&&fl/ua>=.5){var mid=Math.floor(fl/ua);scope.targetLapsA=mid>1?mid-1:null,scope.targetFuelA=scope.targetLapsA?fl/scope.targetLapsA:null,scope.targetLapsB=mid,scope.targetFuelB=fl/mid,scope.targetLapsC=mid+1,scope.targetFuelC=fl/(mid+1)}else scope.targetLapsA=scope.targetLapsB=scope.targetLapsC=scope.targetFuelA=scope.targetFuelB=scope.targetFuelC=null})(curFuelLevel,scope.usageAvg),null!=scope.usageQualy&&(scope.remainQualy=curFuelLevel/scope.usageQualy)',
    'fuel-calc.js target-laps calculation'
  );
  // Reset state on disconnect/reset.
  src = mustReplace(
    src,
    'refuelAvg:null,refuelQualy:null,refuelLast:null,refuelCustom:null,extraMode:2',
    'refuelAvg:null,refuelQualy:null,refuelLast:null,refuelCustom:null,targetLapsA:null,targetFuelA:null,targetLapsB:null,targetFuelB:null,targetLapsC:null,targetFuelC:null,extraMode:2',
    'fuel-calc.js dataEmpty targetLaps'
  );
  // AppCtrl copies each setting from config to $scope by explicit name (not a generic merge) —
  // without this line the toggle changes the saved setting but the live widget never sees it.
  src = mustReplace(
    src,
    '$scope.showLast=config.showLast,$scope.showCustom=config.showCustom',
    '$scope.showLast=config.showLast,$scope.showTargetLaps=config.showTargetLaps,$scope.showCustom=config.showCustom',
    'fuel-calc.js AppCtrl showTargetLaps scope copy'
  );

  // "Avg 5" row: a SIMPLE (non-trimmed) mean of the last 5 laps, matching irdashies'
  // calculateSimpleAverage — distinct from Kapps' own "Average" row, which drops the best
  // and worst lap before averaging. Reuses the SAME rolling 5-lap `fuels` array Kapps already
  // maintains for that trimmed mean, so no new state tracking is needed — just a second,
  // simpler reduction over the same data, computed right alongside the existing usageAvg calc.
  // It also fixes that trimmed mean, which sorted the per-lap fuel use as text (10.1 L before
  // 9.8 L) and so could drop the wrong laps.
  src = mustReplace(
    src,
    'fuels.length&&((f=fuels.slice()).length>=3&&(f=f.sort().slice(1,-1)),total=f.reduce((function(a,b){return a+b})),scope.usageAvg=total/f.length)',
    'fuels.length&&(scope.usageAvg5=fuels.reduce((function(a,b){return a+b}),0)/fuels.length,(f=fuels.slice()).length>=3&&(f=f.sort(function(a,b){return a-b}).slice(1,-1)),total=f.reduce((function(a,b){return a+b})),scope.usageAvg=total/f.length)',
    'fuel-calc.js usageAvg5 computation'
  );
  src = mustReplace(
    src,
    'null!=scope.usageQualy&&(scope.remainQualy=curFuelLevel/scope.usageQualy),null!=scope.usageLast&&(scope.remainLast=curFuelLevel/scope.usageLast)',
    'null!=scope.usageQualy&&(scope.remainQualy=curFuelLevel/scope.usageQualy),null!=scope.usageAvg5&&(scope.remainAvg5=curFuelLevel/scope.usageAvg5),null!=scope.usageLast&&(scope.remainLast=curFuelLevel/scope.usageLast)',
    'fuel-calc.js remainAvg5 computation'
  );
  src = mustReplace(
    src,
    'null!=scope.usageQualy&&(scope.refuelQualy=(lapsLeft-scope.remainQualy)*scope.usageQualy,scope.refuelQualy>=1&&(scope.refuelQualy+=.5)),null!=scope.usageLast&&(scope.refuelLast=(lapsLeft-scope.remainLast)*scope.usageLast,scope.refuelLast>=1&&(scope.refuelLast+=.5))',
    'null!=scope.usageQualy&&(scope.refuelQualy=(lapsLeft-scope.remainQualy)*scope.usageQualy,scope.refuelQualy>=1&&(scope.refuelQualy+=.5)),null!=scope.usageAvg5&&(scope.refuelAvg5=(lapsLeft-scope.remainAvg5)*scope.usageAvg5,scope.refuelAvg5>=1&&(scope.refuelAvg5+=.5)),null!=scope.usageLast&&(scope.refuelLast=(lapsLeft-scope.remainLast)*scope.usageLast,scope.refuelLast>=1&&(scope.refuelLast+=.5))',
    'fuel-calc.js refuelAvg5 computation'
  );
  src = mustReplace(
    src,
    'case 0:if(null!=scope.usageAvg&&(scope.extraAvg=scope.refuelAvg-scope.usageAvg),null!=scope.usageQualy&&(scope.extraQualy=scope.refuelQualy-scope.usageQualy),null!=scope.usageLast&&(scope.extraLast=scope.refuelLast-scope.usageLast)',
    'case 0:if(null!=scope.usageAvg&&(scope.extraAvg=scope.refuelAvg-scope.usageAvg),null!=scope.usageQualy&&(scope.extraQualy=scope.refuelQualy-scope.usageQualy),null!=scope.usageAvg5&&(scope.extraAvg5=scope.refuelAvg5-scope.usageAvg5),null!=scope.usageLast&&(scope.extraLast=scope.refuelLast-scope.usageLast)',
    'fuel-calc.js extraAvg5 case 0'
  );
  src = mustReplace(
    src,
    'case 1:if(null!=scope.usageAvg&&(scope.extraAvg=scope.refuelAvg+scope.usageAvg),null!=scope.usageQualy&&(scope.extraQualy=scope.refuelQualy+scope.usageQualy),null!=scope.usageLast&&(scope.extraLast=scope.refuelLast+scope.usageLast)',
    'case 1:if(null!=scope.usageAvg&&(scope.extraAvg=scope.refuelAvg+scope.usageAvg),null!=scope.usageQualy&&(scope.extraQualy=scope.refuelQualy+scope.usageQualy),null!=scope.usageAvg5&&(scope.extraAvg5=scope.refuelAvg5+scope.usageAvg5),null!=scope.usageLast&&(scope.extraLast=scope.refuelLast+scope.usageLast)',
    'fuel-calc.js extraAvg5 case 1'
  );
  src = mustReplace(
    src,
    'null!=scope.usageAvg&&(scope.extraAvg=(scope.remainAvg-lapsLeft)*scope.usageAvg,scope.extraAvg>=-2&&(fuelOnPit=0),scope.extraAvg=Math.max(0,scope.extraAvg+fuelOnPit)),null!=scope.usageQualy&&(scope.extraQualy=Math.max(0,(scope.remainQualy-lapsLeft)*scope.usageQualy+fuelOnPit)),null!=scope.usageLast&&(scope.extraLast=Math.max(0,(scope.remainLast-lapsLeft)*scope.usageLast+fuelOnPit))',
    'null!=scope.usageAvg&&(scope.extraAvg=(scope.remainAvg-lapsLeft)*scope.usageAvg,scope.extraAvg>=-2&&(fuelOnPit=0),scope.extraAvg=Math.max(0,scope.extraAvg+fuelOnPit)),null!=scope.usageQualy&&(scope.extraQualy=Math.max(0,(scope.remainQualy-lapsLeft)*scope.usageQualy+fuelOnPit)),null!=scope.usageAvg5&&(scope.extraAvg5=Math.max(0,(scope.remainAvg5-lapsLeft)*scope.usageAvg5+fuelOnPit)),null!=scope.usageLast&&(scope.extraLast=Math.max(0,(scope.remainLast-lapsLeft)*scope.usageLast+fuelOnPit))',
    'fuel-calc.js extraAvg5 case 2'
  );
  src = mustReplace(
    src,
    'usageAvg:null,usageQualy:null,usageLast:null,usageCustom:null,remainAvg:null,remainQualy:null,remainLast:null,remainCustom:null,refuelAvg:null,refuelQualy:null,refuelLast:null,refuelCustom:null',
    'usageAvg:null,usageQualy:null,usageAvg5:null,usageLast:null,usageCustom:null,remainAvg:null,remainQualy:null,remainAvg5:null,remainLast:null,remainCustom:null,refuelAvg:null,refuelQualy:null,refuelAvg5:null,refuelLast:null,refuelCustom:null',
    'fuel-calc.js dataEmpty avg5'
  );
  src = mustReplace(
    src,
    'extraMode:2,extraAvg:null,extraQualy:null,extraLast:null,extraCustom',
    'extraMode:2,extraAvg:null,extraQualy:null,extraAvg5:null,extraLast:null,extraCustom',
    'fuel-calc.js dataEmpty extraAvg5'
  );
  src = mustReplace(
    src,
    '$scope.showQualy=config.showQualy,$scope.showLast=config.showLast,$scope.showTargetLaps=config.showTargetLaps',
    '$scope.showQualy=config.showQualy,$scope.showAvg5=config.showAvg5,$scope.showLast=config.showLast,$scope.showTargetLaps=config.showTargetLaps',
    'fuel-calc.js AppCtrl showAvg5 scope copy'
  );

  return src;
}

function patchFuelCalcHtml(src) {
  const targetLapsRow =
    '\t\t\t\t<div ng-if="showTargetLaps && fuelCalc.targetLapsA" class="cell target-laps">\r\n' +
    '\t\t\t\t\t<div class="header">L{{ fuelCalc.targetLapsA }}</div>\r\n' +
    '\t\t\t\t\t<div fuel-calc-value="targetFuelA" class="value"></div>\r\n' +
    '\t\t\t\t</div>\r\n' +
    '\t\t\t\t<div ng-if="showTargetLaps && fuelCalc.targetLapsB" class="cell target-laps current">\r\n' +
    '\t\t\t\t\t<div class="header">L{{ fuelCalc.targetLapsB }}</div>\r\n' +
    '\t\t\t\t\t<div fuel-calc-value="targetFuelB" class="value"></div>\r\n' +
    '\t\t\t\t</div>\r\n' +
    '\t\t\t\t<div ng-if="showTargetLaps && fuelCalc.targetLapsC" class="cell target-laps">\r\n' +
    '\t\t\t\t\t<div class="header">L{{ fuelCalc.targetLapsC }}</div>\r\n' +
    '\t\t\t\t\t<div fuel-calc-value="targetFuelC" class="value"></div>\r\n' +
    '\t\t\t\t</div>\r\n';
  src = mustReplace(
    src,
    '\t\t\t\t<div ng-if="showCustom" class="cell custom">\r\n\t\t\t\t\t<div fuel-calc-value="extraCustom" class="value"></div>\r\n\t\t\t\t</div>\r\n\r\n\t\t\t</div>',
    '\t\t\t\t<div ng-if="showCustom" class="cell custom">\r\n\t\t\t\t\t<div fuel-calc-value="extraCustom" class="value"></div>\r\n\t\t\t\t</div>\r\n\r\n' + targetLapsRow + '\r\n\t\t\t</div>',
    'fuel-calc.html target-laps row'
  );

  // "Avg 5" row, placed right after "Average" (before "Qualify") — a natural reading position
  // since it's directly comparable to Average, just with a different averaging window.
  const avg5Row =
    '\t\t\t\t<div ng-if="showAvg5" class="cell avg5">\r\n' +
    '\t\t\t\t\t<div class="header">Avg 5</div>\r\n' +
    '\t\t\t\t\t<div fuel-calc-value="usageAvg5" class="value"></div>\r\n' +
    '\t\t\t\t</div>\r\n' +
    '\t\t\t\t<div ng-if="showAvg5" class="cell avg5">\r\n' +
    '\t\t\t\t\t<div fuel-calc-value="remainAvg5" class="value"></div>\r\n' +
    '\t\t\t\t</div>\r\n' +
    '\t\t\t\t<div ng-if="showAvg5" class="cell avg5">\r\n' +
    '\t\t\t\t\t<div fuel-calc-value="refuelAvg5" class="value"></div>\r\n' +
    '\t\t\t\t</div>\r\n' +
    '\t\t\t\t<div ng-if="showAvg5" class="cell avg5">\r\n' +
    '\t\t\t\t\t<div fuel-calc-value="extraAvg5" class="value"></div>\r\n' +
    '\t\t\t\t</div>\r\n\r\n';
  src = mustReplace(
    src,
    '\t\t\t\t<div class="cell avg">\r\n\t\t\t\t\t<div ng-click="toggleExtraMode()" class="header clickable">\r\n\t\t\t\t\t\t<span ng-if="fuelCalc.extraMode == 0">Refuel -1L</span>\r\n\t\t\t\t\t\t<span ng-if="fuelCalc.extraMode == 1">Refuel +1L</span>\r\n\t\t\t\t\t\t<span ng-if="fuelCalc.extraMode == 2">Fuel at End</span>\r\n\t\t\t\t\t</div>\r\n\t\t\t\t\t<div fuel-calc-value="extraAvg" class="value"></div>\r\n\t\t\t\t</div>\r\n\r\n\t\t\t\t<div ng-if="showQualy" class="cell qualy">',
    '\t\t\t\t<div class="cell avg">\r\n\t\t\t\t\t<div ng-click="toggleExtraMode()" class="header clickable">\r\n\t\t\t\t\t\t<span ng-if="fuelCalc.extraMode == 0">Refuel -1L</span>\r\n\t\t\t\t\t\t<span ng-if="fuelCalc.extraMode == 1">Refuel +1L</span>\r\n\t\t\t\t\t\t<span ng-if="fuelCalc.extraMode == 2">Fuel at End</span>\r\n\t\t\t\t\t</div>\r\n\t\t\t\t\t<div fuel-calc-value="extraAvg" class="value"></div>\r\n\t\t\t\t</div>\r\n\r\n' + avg5Row + '\t\t\t\t<div ng-if="showQualy" class="cell qualy">',
    'fuel-calc.html avg5 row'
  );

  return src;
}

function patchFuelCalcCss(src) {
  const rule = 'body>#app>.app>.wrap>.cell.target-laps.current{color:#4caf50}';
  if (src.includes(rule)) throw new Error('fuel-calc.css already contains the target-laps rule — patch already applied?');
  src += rule;
  // Avg 5 has no dedicated theme color of its own (that would need theme-editor UI changes
  // well beyond this feature's scope) — reuses Average's color since it's directly related.
  const avg5Rule = 'body>#app>.app>.wrap>.cell.avg5{color:var(--theme-average-color)}';
  if (src.includes(avg5Rule)) throw new Error('fuel-calc.css already contains the avg5 rule — patch already applied?');
  return src + avg5Rule;
}

// Fuel Calculator's settings panel exists twice — the widget's own standalone settings.html,
// and an embedded copy inside the main settings window (racing-overlay/settings/fuel-calc.html)
// — with different indentation levels, so each needs its own anchor text.
function patchFuelCalcSettingsHtml(src) {
  // Target Laps must be inserted BEFORE Avg 5, since Avg 5's anchor ends on the
  // "<!-- target laps -->" comment that this insertion creates — on a fresh install neither
  // exists yet, so this ordering is required (not just cosmetic).
  src = mustReplace(
    src,
    '\t\t\t\t\t<!-- custom -->\r\n\t\t\t\t\t<div class="form-group">\r\n\t\t\t\t\t\t<label for="inputFuelCalcCustom" class="col-sm-3 control-label">Custom</label>',
    '\t\t\t\t\t<!-- target laps -->\r\n\t\t\t\t\t<div class="form-group">\r\n\t\t\t\t\t\t<label for="inputFuelCalcTargetLaps" class="col-sm-3 control-label">Target Laps</label>\r\n\t\t\t\t\t\t<div class="col-sm-9">\r\n\t\t\t\t\t\t\t<div class="checkbox">\r\n\t\t\t\t\t\t\t\t<label>\r\n\t\t\t\t\t\t\t\t\t<input ng-model="settings.showTargetLaps" ng-change="saveSettings()" type="checkbox" id="inputFuelCalcTargetLaps">\r\n\t\t\t\t\t\t\t\t\tShow fuel-per-lap targets for laps around your current average pace\r\n\t\t\t\t\t\t\t\t</label>\r\n\t\t\t\t\t\t\t</div>\r\n\t\t\t\t\t\t</div>\r\n\t\t\t\t\t</div>\r\n\t\t\t\t\t<!-- custom -->\r\n\t\t\t\t\t<div class="form-group">\r\n\t\t\t\t\t\t<label for="inputFuelCalcCustom" class="col-sm-3 control-label">Custom</label>',
    'fuel-calc/settings.html target-laps toggle'
  );
  src = mustReplace(
    src,
    '\t\t\t\t\t\t\t\t\t<input ng-model="settings.showLast" ng-change="saveSettings()" type="checkbox" id="inputFuelCalcLast">\r\n\t\t\t\t\t\t\t\t\tShow last lap fuel usage and calculations\r\n\t\t\t\t\t\t\t\t</label>\r\n\t\t\t\t\t\t\t</div>\r\n\t\t\t\t\t\t</div>\r\n\t\t\t\t\t</div>\r\n\t\t\t\t\t<!-- target laps -->',
    '\t\t\t\t\t\t\t\t\t<input ng-model="settings.showLast" ng-change="saveSettings()" type="checkbox" id="inputFuelCalcLast">\r\n\t\t\t\t\t\t\t\t\tShow last lap fuel usage and calculations\r\n\t\t\t\t\t\t\t\t</label>\r\n\t\t\t\t\t\t\t</div>\r\n\t\t\t\t\t\t</div>\r\n\t\t\t\t\t</div>\r\n\t\t\t\t\t<!-- avg 5 -->\r\n\t\t\t\t\t<div class="form-group">\r\n\t\t\t\t\t\t<label for="inputFuelCalcAvg5" class="col-sm-3 control-label">Avg 5</label>\r\n\t\t\t\t\t\t<div class="col-sm-9">\r\n\t\t\t\t\t\t\t<div class="checkbox">\r\n\t\t\t\t\t\t\t\t<label>\r\n\t\t\t\t\t\t\t\t\t<input ng-model="settings.showAvg5" ng-change="saveSettings()" type="checkbox" id="inputFuelCalcAvg5">\r\n\t\t\t\t\t\t\t\t\tShow simple average fuel usage and calculations over the last 5 laps\r\n\t\t\t\t\t\t\t\t</label>\r\n\t\t\t\t\t\t\t</div>\r\n\t\t\t\t\t\t</div>\r\n\t\t\t\t\t</div>\r\n\t\t\t\t\t<!-- target laps -->',
    'fuel-calc/settings.html avg5 toggle'
  );
  return src;
}

function patchRacingOverlayFuelCalcSettingsHtml(src) {
  src = mustReplace(
    src,
    '\t\t<!-- custom -->\r\n\t\t<div class="form-group">\r\n\t\t\t<label for="inputFuelCalcCustom" class="col-sm-3 control-label">Custom</label>',
    '\t\t<!-- target laps -->\r\n\t\t<div class="form-group">\r\n\t\t\t<label for="inputFuelCalcTargetLaps" class="col-sm-3 control-label">Target Laps</label>\r\n\t\t\t<div class="col-sm-9">\r\n\t\t\t\t<div class="checkbox">\r\n\t\t\t\t\t<label>\r\n\t\t\t\t\t\t<input ng-model="settings.showTargetLaps" ng-change="saveSettings()" type="checkbox" id="inputFuelCalcTargetLaps">\r\n\t\t\t\t\t\tShow fuel-per-lap targets for laps around your current average pace\r\n\t\t\t\t\t</label>\r\n\t\t\t\t</div>\r\n\t\t\t</div>\r\n\t\t</div>\r\n\t\t<!-- custom -->\r\n\t\t<div class="form-group">\r\n\t\t\t<label for="inputFuelCalcCustom" class="col-sm-3 control-label">Custom</label>',
    'racing-overlay/settings/fuel-calc.html target-laps toggle'
  );
  src = mustReplace(
    src,
    '\t\t\t\t\t\t<input ng-model="settings.showLast" ng-change="saveSettings()" type="checkbox" id="inputFuelCalcLast">\r\n\t\t\t\t\t\tShow last lap fuel usage and calculations\r\n\t\t\t\t\t</label>\r\n\t\t\t\t</div>\r\n\t\t\t</div>\r\n\t\t</div>\r\n\t\t<!-- target laps -->',
    '\t\t\t\t\t\t<input ng-model="settings.showLast" ng-change="saveSettings()" type="checkbox" id="inputFuelCalcLast">\r\n\t\t\t\t\t\tShow last lap fuel usage and calculations\r\n\t\t\t\t\t</label>\r\n\t\t\t\t</div>\r\n\t\t\t</div>\r\n\t\t</div>\r\n\t\t<!-- avg 5 -->\r\n\t\t<div class="form-group">\r\n\t\t\t<label for="inputFuelCalcAvg5" class="col-sm-3 control-label">Avg 5</label>\r\n\t\t\t<div class="col-sm-9">\r\n\t\t\t\t<div class="checkbox">\r\n\t\t\t\t\t<label>\r\n\t\t\t\t\t\t<input ng-model="settings.showAvg5" ng-change="saveSettings()" type="checkbox" id="inputFuelCalcAvg5">\r\n\t\t\t\t\t\tShow simple average fuel usage and calculations over the last 5 laps\r\n\t\t\t\t\t</label>\r\n\t\t\t\t</div>\r\n\t\t\t</div>\r\n\t\t</div>\r\n\t\t<!-- target laps -->',
    'racing-overlay/settings/fuel-calc.html avg5 toggle'
  );
  return src;
}

function patchAvg5SharedSettings(src, label) {
  // Must run AFTER patchTargetLapsSharedSettings — inserts showAvg5 between showLast and
  // showTargetLaps, so it needs the post-target-laps-patch anchor text.
  const A_from = 'showQualy:!0,showLast:!1,showTargetLaps:!1,showCustom:!1,showClock:!1,clockStyle:"24",hideClockWhenInMulticlass:!0';
  const A_to = 'showQualy:!0,showLast:!1,showAvg5:!1,showTargetLaps:!1,showCustom:!1,showClock:!1,clockStyle:"24",hideClockWhenInMulticlass:!0';
  const B_from = '"showQualy","showLast","showTargetLaps","showCustom","showClock","clockStyle","hideClockWhenInMulticlass"';
  const B_to = '"showQualy","showLast","showAvg5","showTargetLaps","showCustom","showClock","clockStyle","hideClockWhenInMulticlass"';

  const countA = src.split(A_from).length - 1;
  if (countA < 1) throw new Error(`Expected at least 1 occurrence of the ${label} fuelCalc defaultSettings anchor (avg5), found 0. This Kapps version's code doesn't match what this patch expects — aborting without changing anything.`);
  src = src.split(A_from).join(A_to);

  const countB = src.split(B_from).length - 1;
  if (countB < 1) throw new Error(`Expected at least 1 occurrence of the ${label} fuelCalc urlKeys anchor (avg5), found 0. This Kapps version's code doesn't match what this patch expects — aborting without changing anything.`);
  src = src.split(B_from).join(B_to);

  return src;
}

// Kapps sizes Standings in three places, each with its own copy of the code: index.js (the main process) its
// layer window, racing-overlay.js the overlay page's frame and settings.js the editor's preview. Each copy has
// a table of driver column widths per font/size/condensed preset (40 each), where a missing column crashes the
// sizing, so the patch's columns go in: Fastest Lap sized like Lap Time, the LMU columns' text like Gain. And
// the height grows by the column titles' row per class (see "Standings column titles").
function patchStandingsSizing(src, file) {
  const lapTime = mustMatch(src, /\{"name":"lapTime","options":(\[(?:\{"options":\["[\w-]+"\],"width":\[[\d,]+\]\},?)+\])\}/, `${file} lapTime column widths`)[1];
  const gain = mustMatch(src, /\{"name":"gain","width":(\[[\d,]+\])\}/, `${file} gain column widths`)[1];
  const entries = [
    `{"name":"countryFlag","width":[${Array(40).fill(25)}]}`,
    `{"name":"fastestLap","options":${lapTime}}`,
    ...LMU_COLUMNS.map((c) => `{"name":"${c.name}","width":${gain}}`),
  ];
  src = mustReplace(src, '{"name":"carManufacture","width":[', entries.join(',') + ',{"name":"carManufacture","width":[', `${file} column width table`);
  // the car make column can hold a wordmark logo twice a glyph's width (WORDMARK_LOGOS); the window's spare
  // width otherwise is transparent
  const [make, makeWidths] = mustMatch(src, /\{"name":"carManufacture","width":(\[[\d,]+\])\}/,`${file} carManufacture column widths`);
  src = mustReplace(src, make, `{"name":"carManufacture","width":[${JSON.parse(makeWidths).map((w) => w * 2)}]}`, `${file} carManufacture column width`);
  // where the height adds the bottom rows: <bounds>.height+=<settings>.bottomRows*(<row height>+<gap>)-<gap>,
  const [end, settings, rowHeight, gap] = mustMatch(src, /\w+\.height\+=(\w+)\.bottomRows\*\((\w+)\+(\w+)\)-\3,/, `${file} Standings height`);
  return mustReplace(src, end, `${end.slice(0, -1)}+(${settings}.columnTitles?${settings}.numClasses*(${rowHeight}+${gap}):0),`, `${file} column titles height`);
}

// --- Relatives country flag ---------------------------------------------------------------
// Relatives uses a completely different, older settings system than Standings2: plain
// boolean toggles (showCarNumber, showSRiRBadges, ...) bound directly via AngularJS
// ng-model, not a draggable-column system. The shared widget-registry module (the same one
// patched above for driver.columns) is duplicated across a wider set of files here — every
// widget bundle, plus app.js (the settings-page renderer) and index.js (the main process),
// all carry their own copy. Only the defaultSettings/urlKeys additions need to go in all of
// them; the actual rendering logic only needs to change in relatives.js itself.
function patchRelativesSharedSettings(src, label) {
  src = mustReplace(
    src,
    'showCarNumber:!0,showCarNumberMulticlass:!0,driverNameStyle:"0",driverNameFontStyle:"0",showPitBadge:!0',
    'showCarNumber:!0,showCarNumberMulticlass:!0,showCountryFlag:!0,driverNameStyle:"0",driverNameFontStyle:"0",showPitBadge:!0',
    label + ' relatives defaultSettings'
  );
  src = mustReplace(
    src,
    '"showCarNumber","showCarNumberMulticlass","driverNameStyle","driverNameFontStyle","showPitBadge"',
    '"showCarNumber","showCarNumberMulticlass","showCountryFlag","driverNameStyle","driverNameFontStyle","showPitBadge"',
    label + ' relatives urlKeys'
  );
  return src;
}

function patchRelativesJs(src) {
  src = patchRelativesSharedSettings(src, 'relatives.js');
  src = patchDefaultColumns(src, 'relatives.js (harmless shared copy)');
  src = mustReplace(
    src,
    'd.CarIsPaceCar||d.IsSpectator||(car.carNumber=`#${d.CarNumber}`),config.showManufactureLogo',
    `d.CarIsPaceCar||d.IsSpectator||(car.carNumber=\`#${'$'}{d.CarNumber}\`,car.countryFlagUrl="global"===((${FLAIR_MAP})[d.FlairID]||"global")?"${GLOBE_ICON_DATA_URI}":\`https://flagcdn.com/16x12/${'$'}{(${FLAIR_MAP})[d.FlairID]||"global"}.png\`),config.showManufactureLogo`,
    'relatives.js driver-mapping countryFlagUrl'
  );
  src = mustReplace(
    src,
    '$scope.showCarNumber=config.showCarNumber||config.showCarNumberMulticlass,window.addEventListener("resize"',
    '$scope.showCarNumber=config.showCarNumber||config.showCarNumberMulticlass,$scope.showCountryFlag=config.showCountryFlag,window.addEventListener("resize"',
    'relatives.js $scope.showCountryFlag binding'
  );
  return src;
}

function patchRelativesIndexHtml(src) {
  return mustReplace(
    src,
    '\t\t\t<div ng-if="showCarNumber" ng-style="{\'color\': i.classColorText, \'background-color\': i.classColor}" class="car-number">\r\n\t\t\t\t<div ng-bind="i.carNumber"></div>\r\n\t\t\t</div>\r\n\t\t\t<div class="flex-horizontal flex-spacer driver-name">',
    '\t\t\t<div ng-if="showCarNumber" ng-style="{\'color\': i.classColorText, \'background-color\': i.classColor}" class="car-number">\r\n\t\t\t\t<div ng-bind="i.carNumber"></div>\r\n\t\t\t</div>\r\n\t\t\t<div ng-if="showCountryFlag && i.countryFlagUrl" class="country-flag">\r\n\t\t\t\t<img ng-src="{{i.countryFlagUrl}}" />\r\n\t\t\t</div>\r\n\t\t\t<div class="flex-horizontal flex-spacer driver-name">',
    'relatives/index.html row template'
  );
}

function patchRelativesCss(src) {
  const rule = '.country-flag{display:flex;align-items:center;justify-content:center;padding:0 .25em}.country-flag img{width:16px;height:12px;object-fit:cover;border-radius:1px}';
  if (src.includes(rule)) throw new Error('relatives.css already contains the country-flag rule — patch already applied?');
  return src + rule;
}

function patchRelativesSettingsHtml(src) {
  return mustReplace(
    src,
    '\t\t<!-- driver name style -->',
    '\t\t<!-- country flag -->\r\n\t\t<div ng-if="!isLmu" class="form-group">\r\n\t\t\t<label for="inputRelativesCountryFlag" class="col-sm-3 control-label">Country Flag</label>\r\n\t\t\t<div class="col-sm-9">\r\n\t\t\t\t<label class="checkbox-inline">\r\n\t\t\t\t\t<input ng-model="settings.showCountryFlag" ng-change="saveSettings()" type="checkbox" id="inputRelativesCountryFlag">\r\n\t\t\t\t\tShow driver\'s national flag\r\n\t\t\t\t</label>\r\n\t\t\t</div>\r\n\t\t</div>\r\n\t\t<!-- driver name style -->',
    'settings/relatives.html checkbox'
  );
}

// --- Modern UI + dark theme (main Kapps window) ----------------------------------------------
// Restyles the main window by appending one stylesheet to css/app.css: every colour is a CSS
// variable with a light and a dark set (html[data-theme]), and the stock rules are overridden by
// matching their selectors later in the file, so Kapps' own CSS needs no anchors at all.
const svgUrl = (svg) => `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
const MOON_ICON = svgUrl("<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><path d='M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z' fill='#8a8f99'/></svg>");
const SUN_ICON = svgUrl("<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='#8a8f99' stroke-width='2' stroke-linecap='round'><circle cx='12' cy='12' r='4'/><path d='M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4'/></svg>");

// App-rail icons for the iRacing (stock "Apps") and Le Mans Ultimate tabs; the LMU logo is scaled down
// to 2x its displayed size.
const IRACING_ICON = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxNTUgMTIwLjciPjxwYXRoIGZpbGw9IiNGRkZGRkYiIGQ9Ik05LjksOUM4LjQsOSw3LjYsOS45LDYuNCwxMS40Yy0yLDIuNi0xLjQsMi4yLTAuOSwzLjljMC43LDItMC4xLDMuNSwxLjgsNC4zYzEsMC40LDEuNy0wLjcsMi0yIGMwLjYsMS42LDEsMi42LDEuNiw0LjNjMC42LDAuOCwxLjYsMi4yLDIuNywxLjhjMS42LDAsMiwxLjEsMi4zLDIuMmMtMC41LDEuOSwwLjEsMS44LDEuMSwzYzAuNSwwLjcsMC45LDEuOCwxLjMsMi4xIGMwLjIsMC4yLDAuNywwLjYsMC45LDAuOWMxLjMsMS41LDIuMiwzLjIsMy40LDQuN2MyLjMsMS44LDMuNiwzLjEsNC40LDQuNmMzLjcsNC44LDQuOCw3LjMsNy43LDkuNmMwLjcsMS4xLDIuMiwxLjksMi4zLDMuNCBjMC4zLDIuNyw0LjksNi43LDcuNiw5LjNjNCwzLjksNy44LDcuMSwxMi42LDEwLjFjNC40LDExLjksOCwyNy41LDYuOSw0MC41Yy0wLjYsMi41LTEuMSw0LjctMS42LDcuMWg0Mi44Yy0wLjItMS0wLjQtMi4xLTAuNi0zLjEgYy0wLjEtMC43LTAuNS0xLjQtMC41LTIuMmMwLTAuNSwwLjUtMSwwLjUtMS41YzAuOS0xMy40LDQuOC0yMi4yLDcuMy0zMy44YzAuNC0xLjksMC45LTMuNywwLjctNC41YzMtMiw1LjktMy4zLDcuOS02LjkgYzQuNC0zLjIsNy4zLTYuNCw3LjgtOS44YzEuNS0xLjYsNC45LTEuMyw0LjktNC41YzEuNi0xLjYsMi40LTIuOCwyLjctNC42YzIuMi0yLjgsNS4yLTUuOSw1LjMtNy44YzMtMi4yLDQuOS0zLjcsMy44LTYgYzEuNy0wLjgsMi43LTIuNiwyLjItNC4yYzEuMy0xLjUsMy44LTEuNyw0LjYtMy4yYzAuNC0wLjYsMS0xLjIsMS42LTEuOGMwLjQtMC41LDAuOC0wLjksMS4yLTEuM3YtMi41YzAtMC4xLDAtMC4xLDAtMC4ydi0yLjggYy0wLjEtMC4xLTAuMS0wLjEtMC4yLTAuMmMtMC4yLTAuMi0wLjMtMC40LTAuNS0wLjZjMC4xLTEuOS0wLjktMi43LTMtM2MwLjItMS44LDEtMy45LDEuNS01LjhjMC45LTEuNCwxLjEtMi41LDAuNS0zLjIgYy0xLjItMS4xLTIuMSwwLjEtMy41LDIuNGMtMC42LDEuMy0xLjUsMy4zLTIuMiw0LjZjLTAuOCwxLjEtMS41LDIuMS0yLjIsMy41Yy0xLjMsMS40LTIuOCwzLjktMi44LDUuOGMtMC43LDAuOS0wLjgsMS41LTEuNSwxLjkgYy0wLjMtMC4xLTAuOC0wLjMtMS4zLDAuM2MtMC4yLDAuOC0wLjcsMS4zLTAuNywxLjhjLTEuNS0wLjYtMi42LDAuNy0zLjQsMy4yYy0wLjUsMC4zLTEuOCwwLjctMS44LDEuMWMtMC42LDAuNS0wLjgsMS4xLTEuNCwxLjUgYy0xLjQsMC4yLTEuNiwxLjctMi40LDIuNWMtMC44LDAuMy0xLjQsMS4zLTEuOSwyLjNjLTEtMC4xLTIuMSwxLjMtMi42LDIuNGMtMS45LDEuMS0yLjYsMi0zLjIsMy42Yy0xLjQsMC4xLTMuMiwwLjktNCwyLjYgYy0xLjUsMS0zLjIsMi42LTMuOSw0LjJjLTEuNiwxLjEtMi42LDIuNy00LjIsNS4yYy0xLjctMC44LTMuNi0wLjgtNS41LDBjLTEuMi0wLjMtMi4zLTAuNS0zLjUtMC43Yy0wLjctMC43LTAuNy0xLjQtMC4zLTIgYzAtMC43LDAtMS41LDAtMi4zYzAuNS0xLjgsMS0zLjYsMS41LTUuNWMxLjQtMy40LDEuNC02LjQsMC45LTkuNmMwLjItMi44LTAuMS01LjUtMS40LTguNGMtMy4yLTIuMy03LjgtNC4yLTExLjctNC4yIGMtNC44LTAuNi04LjIsMC0xMS41LDEuOGMtMS44LDEtMy40LDIuMy01LjIsMy40Yy0xLjksMS0zLjYsNS41LTUuMyw4LjJjLTEuOCwzLjktMC40LDQuMywxLjMsMy41aDAuMWMtMy4yLTAuMS0wLjMtMywxLjEtMy4xIGM0LjYtMC41LDkuNi0wLjMsMTYuNyw0LjFjMi4yLDEuMyw0LjQsMi40LDYuNCwxLjhjMC45LDEuMS0xLDIuNy0zLjEsMy4yYy0xMC4yLDAuNi0xOS44LDAuNi0yMC43LTEuOWMwLjQtMS40LDAuNS0yLjksMC43LTQuMiBjLTAuMiwwLTAuMywwLTAuNSwwLjFjMC43LDAuNC0wLjEsMy4yLTAuMyw1LjFjLTEuMywxLTEuNywyLjQtMS4zLDQuM2MwLjUsMS40LDEsMi45LDAuNSw1Yy0wLjYsMC4xLTEuMiwwLjItMS44LDAuMyBjLTAuOS0wLjUtMS42LTAuOS0yLjUtMS4zYy0xLjQtMC4zLTIuNC0wLjItMy4zLDAuMmMtMS4zLTEuNi0yLjctMS43LTQtMS41Yy0wLjktMC43LTEuNy0xLjUtMi42LTIuMmMtMC4yLTIuOC0xLjYtNC43LTQuMy00LjkgYy0xLjEtMC45LTIuMy0xLjMtMy41LTIuMWMwLTAuNywwLTEuNSwwLTIuM2MtMC41LTEuNC0xLjItMi44LTMuNS0zLjVjLTEuOCwwLjItMi4zLTEuNi0zLjQtMy4yYy0xLjQtMS4yLTIuOC0yLjYtNC4yLTMuNyBjLTAuNy0xLTIuMS0xLjYtMi44LTIuNmMtMS0wLjUtMS41LTEuMy0yLjUtMS44Yy0wLjQtMC40LTEtMS43LTEuNi0yLjNjLTAuNi0wLjUtMS4zLTAuNC0xLjctMC40Yy0wLjUtMC44LTAuNy0wLjktMS4xLTEuNyBjLTEtMC44LTItMS41LTMuMS0yLjNjLTAuOC0xLTEuNi0yLTIuNS0zYy0wLjctMC41LTEuMy0xLTItMS41Yy0xLjMtMi42LTMuNS01LjItNC42LTcuM2MtMC44LTEuMS0wLjUtMS45LTEuMi0zIGMtMC40LTAuNy0wLjctMS40LTEuMS0yLjFMMTAuMSwwSDguNkM4LjQsMC41LDguMywxLjMsOC4zLDIuMmMwLjMsMS4zLDAuNywyLjUsMSwzLjhDOS4zLDcuMSw5LjksNy44LDkuOSw5eiBNNjguOSw1NS4yIGMxLjQsNi43LDEzLjgsMy45LDI2LjYsMC40Yy01LjMsMi41LTEwLjksNS4yLTE4LDVDNzEsNjAuNSw2Ny41LDU4LjgsNjguOSw1NS4yeiIvPjxwYXRoIGZpbGw9IiMyRTM1OEMiIGQ9Ik0xNTQuOCwyMi44Yy0wLjEsMC4xLTAuMiwwLjItMC4yLDAuM2MwLDAuNSwwLjEsMC44LDAuMiwxLjFWMjIuOHoiLz48cGF0aCBmaWxsPSIjMjkzRTkxIiBkPSJNNzcuNCw2MC42YzcuMiwwLjIsMTIuNy0yLjUsMTgtNWMtMTIuNywzLjUtMjUuMSw2LjMtMjYuNi0wLjRDNjcuNSw1OC44LDcxLDYwLjUsNzcuNCw2MC42eiIvPjxwYXRoIGZpbGw9IiMyOTNFOTEiIGQ9Ik0xNTQuNCwyMC4xYzAuMSwwLjEsMC4xLDAuMSwwLjIsMC4ydjBDMTU0LjYsMjAuMiwxNTQuNSwyMC4xLDE1NC40LDIwLjF6Ii8+PHBhdGggZmlsbD0iIzI5M0U5MSIgZD0iTTE1NC42LDI1LjhMMTU0LjYsMjUuOGMtMC40LDAuNC0wLjgsMC44LTEuMiwxLjNDMTUzLjgsMjYuNywxNTQuMiwyNi4yLDE1NC42LDI1Ljh6Ii8+PHBhdGggZmlsbD0iIzI5M0U5MSIgZD0iTTExLjUsMi41YzAuNCwwLjcsMC43LDEuNCwxLjEsMi4xTDExLjUsMi41eiIvPjxwYXRoIGZpbGw9IiMyRTM1OEMiIGQ9Ik0xNTQuOC0wLjJIOS44YzAuMSwwLDAuMiwwLjEsMC4zLDAuMWMwLjUsMC45LDAuOSwxLjgsMS40LDIuN2wxLjEsMi4xYzAuNywxLjEsMC40LDEuOSwxLjIsMyBjMS4xLDIuMSwzLjMsNC43LDQuNiw3LjNjMC43LDAuNSwxLjMsMSwyLDEuNWMwLjksMSwxLjcsMiwyLjUsM2MxLDAuNywyLDEuNSwzLjEsMi4zYzAuNSwwLjgsMC42LDAuOSwxLjEsMS43IGMwLjUsMCwxLjEtMC4xLDEuNywwLjRjMC43LDAuNiwxLjMsMS45LDEuNiwyLjNjMSwwLjUsMS41LDEuMywyLjUsMS44YzAuNywxLDIuMSwxLjYsMi44LDIuNmMxLjQsMS4xLDIuOCwyLjUsNC4yLDMuNyBjMS4xLDEuNiwxLjUsMy40LDMuNCwzLjJjMi4zLDAuNywzLDIuMSwzLjUsMy41YzAsMC43LDAsMS41LDAsMi4zYzEuMiwwLjksMi40LDEuMywzLjUsMi4xYzIuNywwLjIsNC4xLDIuMiw0LjMsNC45IGMwLjksMC43LDEuNywxLjUsMi42LDIuMmMxLjMtMC4yLDIuNy0wLjEsNCwxLjVjMC45LTAuNCwxLjktMC42LDMuMy0wLjJjMC45LDAuNCwxLjYsMC44LDIuNSwxLjNjMC42LTAuMSwxLjItMC4yLDEuOC0wLjMgYzAuNS0yLjEsMC0zLjYtMC41LTVjLTAuNS0xLjktMC4xLTMuMywxLjMtNC4zYzAuMi0xLjksMS00LjcsMC4zLTUuMWMwLjItMC4xLDAuMy0wLjEsMC41LTAuMWMtMC4yLDEuMy0wLjMsMi44LTAuNyw0LjIgYzAuOSwyLjUsMTAuNSwyLjQsMjAuNywxLjljMi4xLTAuNSwzLjktMi4xLDMuMS0zLjJjLTIsMC42LTQuMi0wLjYtNi40LTEuOGMtNy4xLTQuNC0xMi4xLTQuNi0xNi43LTQuMWMtMS40LDAuMS00LjMsMy0xLjEsMy4xIGgtMC4xYy0xLjYsMC44LTMuMSwwLjQtMS4zLTMuNWMxLjgtMi43LDMuNC03LjIsNS4zLTguMmMxLjgtMSwzLjQtMi4zLDUuMi0zLjRjMy4zLTEuOCw2LjctMi40LDExLjUtMS44YzMuOSwwLDguNSwxLjksMTEuNyw0LjIgYzEuMywyLjksMS41LDUuNSwxLjQsOC40YzAuNSwzLjEsMC41LDYuMi0wLjksOS42Yy0wLjUsMS45LTEsMy43LTEuNSw1LjVjMCwwLjgsMCwxLjUsMCwyLjNjLTAuNSwwLjctMC40LDEuNCwwLjMsMiBjMS4yLDAuMiwyLjMsMC41LDMuNSwwLjdjMS45LTAuOCwzLjgtMC44LDUuNSwwYzEuNi0yLjYsMi42LTQuMiw0LjItNS4yYzAuNy0xLjcsMi40LTMuMiwzLjktNC4yYzAuOS0xLjcsMi42LTIuNCw0LTIuNiBjMC42LTEuNiwxLjMtMi40LDMuMi0zLjZjMC41LTEuMSwxLjUtMi40LDIuNi0yLjRjMC41LTEsMS4xLTIsMS45LTIuM2MwLjktMC45LDEuMS0yLjMsMi40LTIuNWMwLjYtMC40LDAuOC0xLjEsMS40LTEuNSBjMC4xLTAuNSwxLjMtMC45LDEuOC0xLjFjMC44LTIuNSwxLjktMy44LDMuNC0zLjJjMC0wLjYsMC41LTEsMC43LTEuOGMwLjUtMC42LDEtMC41LDEuMy0wLjNjMC43LTAuNCwwLjgtMSwxLjUtMS45IGMwLTEuOSwxLjUtNC40LDIuOC01LjhjMC43LTEuNCwxLjQtMi40LDIuMi0zLjVjMC43LTEuMywxLjUtMy4zLDIuMi00LjZjMS40LTIuNCwyLjMtMy42LDMuNS0yLjRjMC42LDAuNywwLjQsMS44LTAuNSwzLjIgYy0wLjUsMS45LTEuMyw0LTEuNSw1LjhjMi4yLDAuMywzLjEsMS4xLDMsM2MwLjIsMC4yLDAuNCwwLjQsMC41LDAuNmMwLjEsMC4xLDAuMSwwLjEsMC4yLDAuMnYwYzAuMSwwLjEsMC4yLDAuMiwwLjIsMC4zIEwxNTQuOC0wLjJ6Ii8+PHBhdGggZmlsbD0iIzJFMzU4QyIgZD0iTTE1NC42LDI1LjhMMTU0LjYsMjUuOGMtMC40LDAuNS0wLjgsMC45LTEuMiwxLjNjLTAuNiwwLjYtMS4xLDEuMy0xLjYsMS44Yy0wLjgsMS41LTMuMywxLjYtNC42LDMuMiBjMC41LDEuNy0wLjUsMy40LTIuMiw0LjJjMS4xLDIuMy0wLjksMy44LTMuOCw2Yy0wLjIsMS45LTMuMiw1LTUuMyw3LjhjLTAuMywxLjgtMS4xLDMtMi43LDQuNmMwLDMuMi0zLjUsMi45LTQuOSw0LjUgYy0wLjUsMy40LTMuNCw2LjUtNy44LDkuOGMtMiwzLjYtNC45LDQuOS03LjksNi45YzAuMiwwLjgtMC4zLDIuNi0wLjcsNC41Yy0yLjUsMTEuNS02LjQsMjAuNC03LjMsMzMuOGMtMC4xLDAuNS0wLjUsMS0wLjUsMS41IGMwLDAuNywwLjMsMS40LDAuNSwyLjJjMC4yLDEsMC40LDIuMSwwLjYsMy4xaDQ5LjdsMC05NS41QzE1NC44LDI1LjYsMTU0LjcsMjUuNywxNTQuNiwyNS44eiIvPjxwYXRoIGZpbGw9IiNFQjI1MkMiIGQ9Ik01Ny4xLDczLjNjLTQuNy0zLTguNi02LjEtMTIuNi0xMC4xYy0yLjctMi42LTcuMy02LjUtNy42LTkuM2MtMC4yLTEuNS0xLjYtMi4yLTIuMy0zLjRjLTMtMi4zLTQtNC43LTcuNy05LjYgYy0wLjgtMS41LTIuMS0yLjgtNC40LTQuNmMtMS4zLTEuNS0yLjItMy4yLTMuNC00LjdjLTAuMi0wLjItMC43LTAuNy0wLjktMC45Yy0wLjQtMC4zLTAuOC0xLjQtMS4zLTIuMWMtMS0xLjMtMS41LTEuMS0xLjEtMyBjLTAuMy0xLjEtMC43LTIuMi0yLjMtMi4yYy0xLDAuNC0yLTEtMi43LTEuOGMtMC42LTEuNy0xLTIuNi0xLjYtNC4zYy0wLjMsMS4zLTEuMSwyLjQtMiwyYy0xLjgtMC44LTEtMi4yLTEuOC00LjMgYy0wLjYtMS43LTEuMS0xLjMsMC45LTMuOUM3LjYsOS45LDguNCw5LDkuOSw5YzAtMS4yLTAuNi0xLjktMC42LTMuMUM5LDQuNyw4LjYsMy40LDguMywyLjJjMC0xLjEsMC4xLTIuMSwwLjYtMi40SDB2MTIxLjJoNjIuNCBjMC42LTIuNCwxLTQuNiwxLjYtNy4xQzY1LjEsMTAwLjksNjEuNSw4NS4zLDU3LjEsNzMuM3oiLz48L3N2Zz4NCg==';
const LMU_ICON = 'data:image/png;base64,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';

const MODERN_CSS = `
:root {
  --k-bg: #f4f5f7; --k-surface: #fff; --k-surface-2: #f0f2f5; --k-hover: rgba(15, 23, 42, .05);
  --k-border: #e2e5ea; --k-border-strong: #d0d5dc; --k-text: #1c2028; --k-text-muted: #6b7280;
  --k-accent: #4f7be8; --k-accent-soft: rgba(79, 123, 232, .12); --k-on: #22c55e;
  --k-rail: #e3e6eb; --k-tile: #fff; --k-sidebar: #eceef2;
  --k-shadow: 0 1px 2px rgba(16, 24, 40, .05), 0 1px 3px rgba(16, 24, 40, .05);
  color-scheme: light;
}
[data-theme=dark] {
  --k-bg: #15171b; --k-surface: #1d2025; --k-surface-2: #25292f; --k-hover: rgba(255, 255, 255, .05);
  --k-border: #2c3036; --k-border-strong: #3a3f47; --k-text: #e4e6ea; --k-text-muted: #9198a3;
  --k-accent: #7b9cf2; --k-accent-soft: rgba(123, 156, 242, .16);
  --k-rail: #0d0e11; --k-tile: #1f2227; --k-sidebar: #121418;
  --k-shadow: none;
  color-scheme: dark;
}
body { background: var(--k-rail); }
a { color: var(--k-accent); }
hr { border-top-color: var(--k-border); }
.text-muted, .help-block { color: var(--k-text-muted); }

/* window chrome: app rail, sidebar, top menu */
.app .apps-list { background-color: var(--k-rail); }
.app .apps-list .app-item { background-color: var(--k-tile); color: var(--k-text); border-radius: 12px; box-shadow: var(--k-shadow); }
.app .apps-list .app-item:not(.disabled):not(.selected):hover { background-color: var(--k-surface-2); }
.app .apps-list .app-item.selected { background-color: var(--k-accent); color: #fff; }
.app .apps-list .separator { background: var(--k-border); }
.app .apps-list .app-item.server::before, .app .apps-list .app-item.lmu::before { content: ""; height: auto; margin: 7px 9px 1px; background: center / contain no-repeat; }
.app .apps-list .app-item.server::before { background-image: url(${IRACING_ICON}); }
.app .apps-list .app-item.server::after { content: "iracing"; }
.app .apps-list .app-item.lmu::before { background-image: url(${LMU_ICON}); }
.app .apps-list .app-item.lmu::after { content: "lmu"; }
.app .app-sidebar { background-color: var(--k-sidebar); color: var(--k-text); border-right: 1px solid var(--k-border); }
.app .app-sidebar > header { border-bottom-color: var(--k-border); font-weight: 700; font-size: 17px; }
.app .app-sidebar .scroller { padding: 12px 0; }
.app .app-sidebar .scroller > header { opacity: 1; color: var(--k-text-muted); font-size: 10.5px; letter-spacing: .08em; margin-top: 16px; padding-left: 22px; }
.app .app-sidebar .scroller > .app-item { opacity: 1; color: var(--k-text-muted); margin: 1px 10px; padding: 7px 12px; border-radius: 8px; transition: background-color .12s, color .12s; }
.app .app-sidebar .scroller > .app-item:hover { background: var(--k-hover); color: var(--k-text); }
.app .app-sidebar .scroller > .app-item.selected { background: var(--k-accent-soft); color: var(--k-accent); font-weight: 700; }
.app .app-sidebar .scroller > .show-more { opacity: 1; color: var(--k-text-muted); }
.app .app-content { background-color: var(--k-bg); color: var(--k-text); }
.app .app-content > .menu-wrap { background-color: var(--k-surface); border-bottom-color: var(--k-border); }
.app .app-content > .menu-wrap > .menu-item { font-size: 15px; line-height: 54px; opacity: 1; color: var(--k-text-muted); border-bottom: 2px solid transparent; margin: 0 4px 0 22px; transition: color .12s; }
.app .app-content > .menu-wrap > .menu-item:hover { color: var(--k-text); }
.app .app-content > .menu-wrap > .menu-item.selected { color: var(--k-text); border-bottom-color: var(--k-accent); }
.app .app-content > .menu-wrap > .menu-item-external { font-size: 15px; color: var(--k-accent); }
#app > main > .toolbar > .separator { background-color: var(--k-border); }
#app > .flashes > div.info { background-color: var(--k-accent); color: #fff; }
#app > .flashes > div.info a { color: #fff; text-decoration: underline; }
#app > main > .toolbar > button.theme { background-size: 18px; background-repeat: no-repeat; background-image: ${MOON_ICON}; }
[data-theme=dark] #app > main > .toolbar > button.theme { background-image: ${SUN_ICON}; }

/* scrollbars */
.scroller-wrap > .scroller::-webkit-scrollbar { width: 12px; }
.scroller-wrap > .scroller::-webkit-scrollbar-thumb { background-color: var(--k-border-strong); border-radius: 6px; }
.scroller-wrap > .scroller::-webkit-scrollbar-thumb:hover { background-color: var(--k-text-muted); }
.scroller-wrap > .scroller::-webkit-scrollbar-track-piece,
.dropdown-menu.scrollable-menu::-webkit-scrollbar-track-piece { background-color: transparent; }
.scroller-wrap.dark > .scroller:hover::-webkit-scrollbar-thumb { background-color: var(--k-border-strong); }

/* cards */
.panel { background-color: var(--k-surface); border: 1px solid var(--k-border); border-radius: 12px; box-shadow: var(--k-shadow); margin-bottom: 16px; }
.panel-default > .panel-heading { background-color: var(--k-surface); color: var(--k-text); border-color: var(--k-border); border-radius: 11px 11px 0 0; padding: 12px 18px; }
.panel > .panel-heading.off { border-radius: 11px; }
.panel-title { font-size: 15px; font-weight: 700; }
.racing-overlay .panel-title > .toolbar > button { color: var(--k-text-muted); }
.racing-overlay .panel-title > .toolbar > button:hover { color: var(--k-text); }
.racing-overlay .custom-overlays-title { color: var(--k-text-muted); }
pre { background-color: var(--k-surface-2); border-color: var(--k-border); color: var(--k-text); }
code { background-color: var(--k-surface-2); color: var(--k-accent); }
.alert-info { background-color: var(--k-accent-soft); border-color: transparent; color: var(--k-text); }
/* the Debug page's third-party JSON editor has dozens of light-only rules; invert it as a whole */
[data-theme=dark] .jsoneditor { filter: invert(.88) hue-rotate(180deg); }

/* form controls (selectize is the tag picker on the Chat pages) */
.form-control, .selectize-input, .selectize-input.full, .selectize-control.single .selectize-input.input-active { background: var(--k-surface); border-color: var(--k-border-strong); color: var(--k-text); border-radius: 8px; box-shadow: none; transition: border-color .12s, box-shadow .12s; }
.form-control:focus, .selectize-input.focus { border-color: var(--k-accent); box-shadow: 0 0 0 3px var(--k-accent-soft); }
.form-control[disabled], .form-control[readonly], fieldset[disabled] .form-control, .selectize-control .selectize-input.disabled { background: var(--k-surface-2); }
.input-group-addon { background-color: var(--k-surface-2); border-color: var(--k-border-strong); color: var(--k-text-muted); border-radius: 8px; }
.btn { border-radius: 8px; }
.btn-default, .btn-default.disabled:hover, .btn-default.disabled:focus, .btn-default[disabled]:hover, .btn-default[disabled]:focus { background-color: var(--k-surface); border-color: var(--k-border-strong); color: var(--k-text); }
.btn-default:hover, .btn-default:focus, .btn-default.focus { background-color: var(--k-surface-2); border-color: var(--k-border-strong); color: var(--k-text); }
.btn-default.active, .btn-default:active, .open > .dropdown-toggle.btn-default,
.btn-default.active:hover, .btn-default:active:hover, .btn-default.active:focus, .btn-default:active:focus,
.open > .dropdown-toggle.btn-default:hover, .open > .dropdown-toggle.btn-default:focus { background-color: var(--k-accent-soft); border-color: var(--k-accent); color: var(--k-accent); box-shadow: none; }
.dropdown-menu { background-color: var(--k-surface); border: 1px solid var(--k-border); border-radius: 10px; box-shadow: 0 10px 30px rgba(0, 0, 0, .18); padding: 4px; }
.dropdown-menu > li > a { color: var(--k-text); border-radius: 6px; padding: 6px 12px; }
.dropdown-menu > li > a:hover, .dropdown-menu > li > a:focus { background-color: var(--k-surface-2); color: var(--k-text); }
.dropdown-menu > .active > a, .dropdown-menu > .active > a:hover, .dropdown-menu > .active > a:focus { background-color: var(--k-accent); color: #fff; }
.dropdown-menu .divider { background-color: var(--k-border); }
.dropdown-menu > li.dropdown-header { background-color: transparent; color: var(--k-text-muted); }
.checkbox input[type=checkbox]::before, .checkbox-inline input[type=checkbox]::before,
.radio input[type=radio]::before, .radio-inline input[type=radio]::before { background: var(--k-surface); border-color: var(--k-border-strong); box-shadow: none; }
.checkbox input[type=checkbox]::before, .checkbox-inline input[type=checkbox]::before { border-radius: 4px; }
.checkbox input[type=checkbox]:checked::before, .checkbox-inline input[type=checkbox]:checked::before { background: var(--k-accent); border-color: var(--k-accent); }
.radio input[type=radio]:checked:after, .radio-inline input[type=radio]:checked:after { background: var(--k-accent); }
input[type=range]::-webkit-slider-runnable-track { height: 6px; background: var(--k-accent); border-radius: 3px; }
input[type=range]::-webkit-slider-thumb { margin-top: -7px; border: 2px solid var(--k-accent); box-shadow: 0 1px 3px rgba(0, 0, 0, .25); }
.selectize-input input { color: var(--k-text); }
.selectize-input.dropdown-active::before { background: var(--k-border); }
.selectize-dropdown { background: var(--k-surface); border-color: var(--k-border); color: var(--k-text); }
.selectize-dropdown .active { background-color: var(--k-surface-2); color: var(--k-text); }
.selectize-dropdown-header, .selectize-dropdown .optgroup-header { background: var(--k-surface-2); color: var(--k-text-muted); }

/* racing overlay widget tabs */
.racing-overlay .widget-tabs { display: flex; flex-wrap: wrap; gap: 6px; padding: 0 20px 14px; border-bottom: 1px solid var(--k-border); }
.racing-overlay .widget-tabs > a { display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 11px; border: 1px solid var(--k-border); border-radius: 14px; background: var(--k-surface); color: var(--k-text-muted); font-size: 12.5px; text-decoration: none; cursor: pointer; transition: background-color .12s, color .12s, border-color .12s; }
.racing-overlay .widget-tabs > a:hover { color: var(--k-text); border-color: var(--k-border-strong); }
.racing-overlay .widget-tabs > a.selected { background: var(--k-accent); border-color: var(--k-accent); color: #fff; }
.racing-overlay .widget-tabs > a > i { width: 7px; height: 7px; border-radius: 50%; background: var(--k-border-strong); }
.racing-overlay .widget-tabs > a.on > i { background: var(--k-on); }
.racing-overlay .widget-tabs > .divider { width: 1px; margin: 4px; background: var(--k-border); }
.racing-overlay .widget-tabs + .scroller-wrap > .scroller { padding-top: 16px; }

/* Widget settings: listEditor's add/remove/reorder list */
.item-list { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; }
.item-list > .item-row { display: flex; align-items: center; gap: 6px; width: 100%; max-width: 360px; padding: 4px 4px 4px 10px; border: 1px solid var(--k-border); border-radius: 8px; background: var(--k-surface); }
.item-list svg { width: 16px; height: 16px; fill: none; stroke: var(--k-text-muted); stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.item-list > .dropdown { margin-top: 4px; }
`;

function patchAppCss(src) {
  if (src.includes(MODERN_CSS)) throw new Error('app.css already contains the modern UI stylesheet — patch already applied?');
  return src + MODERN_CSS;
}

// Theme is applied before first paint, follows Windows' light/dark setting until the user picks
// one with the toolbar button, and is remembered in the main window's localStorage. Kapps' ngStorage
// treats every localStorage key as its own JSON value (and rewrites them as JSON), so it's stored as JSON.
const THEME_SCRIPT = `<script>
(function () {
  var root = document.documentElement, saved = null;
  try { saved = JSON.parse(localStorage.getItem('kapps-theme')); } catch (e) {}
  root.dataset.theme = saved === 'dark' || saved === 'light' ? saved : matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  window.kappsToggleTheme = function () {
    root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
    localStorage.setItem('kapps-theme', JSON.stringify(root.dataset.theme));
  };
})();
</script>
`;

function patchAppIndexHtml(src) {
  src = mustReplace(src, '</head>', THEME_SCRIPT + '</head>', 'index.html head');
  return mustReplace(
    src,
    '<button ng-click="minimizeApp()" class="minimize"></button>',
    '<button onclick="kappsToggleTheme()" data-tippy-content="Toggle Dark Theme" class="theme"></button><button ng-click="minimizeApp()" class="minimize"></button>',
    'index.html window toolbar'
  );
}

// Racing Overlay's settings page stacks every widget's panel in one long scroll. This adds a row of
// tabs above it and shows one widget at a time. Tab ids are the widgets' settingsMain keys, so each
// <app-settings enabled="settingsMain.<key>"> panel doubles as its own anchor. The selected tab lives
// on $root so it survives switching to another page and back.
const WIDGET_TABS = [
  ['standings2', 'Standings'], ['standings', 'Standings (Legacy)'], ['relatives', 'Relatives'],
  ['fuelCalc', 'Fuel Calculator'], ['pitHelper', 'Pit Helper'], ['mgu', 'MGU'], ['pedals', 'Pedals'],
  ['inputsGraph', 'Inputs Graph'], ['carLeftRight', 'Car Left Right'], ['tyres', 'Tyres'],
  ['trackMap', 'Track Map'], ['twitchChat', 'Twitch Chat'], ['followers', 'Twitch Followers'],
  ['counters', 'Twitch Counters'],
];
// Widgets with no Le Mans Ultimate equivalent: Track Map is an iRacing web map.
const IRACING_ONLY_WIDGETS = ['trackMap'];
// and the other way round: iRacing shares no damage
const LMU_ONLY_WIDGETS = ['damage'];

function patchRacingOverlaySettingsHtml(src) {
  const isTab = (id) => `$root.widgetTab == '${id}'`;
  const showIn = (id) => `ng-show="${isTab(id)}" `;
  // the same page serves iRacing's and LMU's overlays: a widget only one game has gets its tab on that game's,
  // and a remembered tab of the other game's falls back to the first
  const only = (id) => (IRACING_ONLY_WIDGETS.includes(id) ? 'ng-if="!isLmu" ' : LMU_ONLY_WIDGETS.includes(id) ? 'ng-if="isLmu" ' : '');
  // The green "on" dot only means something for widgets; settingsMain.custom/.system don't exist.
  const tab = (id, label) =>
    `<a ${only(id)}ng-click="$root.widgetTab = '${id}'" ng-class="{selected: ${isTab(id)}, on: settingsMain.${id}}">${label}</a>`;
  const list = (ids) => JSON.stringify(ids).replace(/"/g, "'");
  const initTab = `$root.widgetTab = !$root.widgetTab || (isLmu ? ${list(IRACING_ONLY_WIDGETS)} : ${list(LMU_ONLY_WIDGETS)}).indexOf($root.widgetTab) >= 0 ? '${WIDGET_TABS[0][0]}' : $root.widgetTab`;
  for (const [key] of WIDGET_TABS) {
    src = mustReplace(src, `enabled="settingsMain.${key}"`, `${showIn(key)}enabled="settingsMain.${key}"`, `settings.html ${key} panel`);
  }
  for (const cls of ['text-center custom-overlays-title', 'panel panel-default custom-overlay', 'text-center add-custom-overlay']) {
    src = mustReplace(src, `class="${cls}"`, `${showIn('custom')}class="${cls}"`, `settings.html ${cls}`);
  }
  src = mustReplace(src, '<div class="panel panel-default">', `<div ${showIn('system')}class="panel panel-default">`, 'settings.html System panel');
  src = mustReplace(
    src,
    'settings="settingsCounters"\r\n\t>\r\n</app-settings>',
    'settings="settingsCounters"\r\n\t>\r\n</app-settings>' +
      NEW_WIDGETS.map((w) => `\r\n<app-settings ${showIn(w.id)}template="${w.dir}.html" enabled="settingsMain.${w.id}" settings="${settingsVar(w)}"></app-settings>`).join(''),
    'settings.html new widget panels'
  );
  return mustReplace(
    src,
    '<div class="scroller-wrap">',
    `<nav class="widget-tabs" ng-init="${initTab}">` +
      [...WIDGET_TABS, ...NEW_WIDGETS.map((w) => [w.id, w.title])].map(([key, label]) => tab(key, `<i></i>${label}`)).join('') +
      '<span class="divider"></span>' +
      tab('custom', 'Custom Overlays') +
      tab('system', 'System') +
      '</nav><div class="scroller-wrap">',
    'settings.html widget tabs'
  );
}

// --- Le Mans Ultimate ---------------------------------------------------------------------
// LMU gets a game tab under iRacing's (stock "Apps", restyled with the iRacing logo in MODERN_CSS) with
// its own Racing Overlay: the same settings page, widgets and layer windows as iRacing's, but separate
// profiles, stored under $localStorage.lmu where iRacing's live under $localStorage.server. Its widgets
// connect to an LMU bridge on LMU_PORT instead of Kapps' iRacing server on 8182. The bridge
// (LMU_BRIDGE_PY) is a Python program that translates LMU's shared memory into iRacing's telemetry
// variables and protocol; it runs on Kapps' bundled Python as lmu.exe, a copy of Kapps' own launcher
// (which runs lib/<exe name>__init__.py), started and restarted like Kapps' other helper apps.
const LMU_PORT = 8187;

// Standings columns with nothing behind them in LMU (SOF, humidity, driver nationality, joker laps, iRacing's one
// tyre compound per car, which LMU's Tyres column replaces, and ratings until there's a source for LMU's Safety
// and Driver Ratings)
const LMU_DROPPED_COLUMNS = { header: ['sof', 'humidity'], driver: ['country-flag', 'joker', 'tyre-compound', 'ratings'] };

// iRacing's and LMU's overlay profiles together: the main process (layer windows, tray) and the overlay
// page look profiles up by id across both games.
const RACING_OVERLAYS_JS =
  'window.kappsRacingOverlaySettings=function(storage){return["server","lmu"].map(function(game){return storage[game]&&storage[game].racingOverlay&&storage[game].racingOverlay.settings}).filter(Boolean)};' +
  'window.kappsRacingOverlays=function(storage){var s=kappsRacingOverlaySettings(storage);return[[].concat.apply([],s.map(function(x){return x.profiles||[]})),[].concat.apply([],s.map(function(x){return x.customOverlays||[]}))]};' +
  // Widget options with nothing behind them in LMU (no SOF, incident count, rating gain, driver nationality,
  // humidity, joker laps or iRacing tyre compounds), switched off in LMU overlays' widget URLs. "settings"
  // is Standings' whole column setup; lmu:true there stops the patch's own Country Flag column auto-adding.
  'window.kappsLmuSettings={sofFlag:function(){return 0},incidentsFlag:function(){return 0},showIRatingGain:function(){return 0},showCountryFlag:function(){return 0},trackInfoFlag:function(v){return 3&v},' +
  `settings:function(v){var dropped=${JSON.stringify(LMU_DROPPED_COLUMNS)};v=JSON.parse(JSON.stringify(v));v.lmu=!0;for(var row in dropped)v[row].columns=v[row].columns.filter(function(c){return dropped[row].indexOf(c)<0});return v}};`;

function patchLmuAppJs(src) {
  src = mustReplace(
    src,
    '(()=>{var account,app,appWindow,autoUpdater,ipcRenderer,menu,racingOverlaysData,uuid,',
    '(()=>{' + RACING_OVERLAYS_JS + 'var account,app,appWindow,autoUpdater,ipcRenderer,menu,racingOverlaysData,uuid,',
    'app.js racing overlay profile helpers'
  );
  src = mustReplace(
    src,
    '.state("server",{parent:"index"',
    '.state("lmu",{parent:"index",url:"lmu",redirectTo:"lmu.racing-overlay",views:{"":{templateUrl:"apps/app.html"},"sidebar@lmu":{templateUrl:"apps/lmu/sidebar.html"}}})' +
      '.state("lmu.racing-overlay",{url:"/racing-overlay",redirectTo:"lmu.racing-overlay.settings",template:\'<div ui-view autoscroll class="racing-overlay"></div>\',data:{menu:[{url:".racing-overlay.settings",title:"Settings"}]}})' +
      '.state("lmu.racing-overlay.settings",{url:"/settings",templateUrl:"apps/server/racing-overlay/settings/settings.html",controller:"ServerRacingOverlaySettingsCtrl",data:{noScroll:!0}})' +
      '.state("lmu.about",{url:"/about",templateUrl:"apps/lmu/about.html"})' +
      '.state("server",{parent:"index"',
    'app.js lmu states'
  );
  src = mustReplace(
    src,
    '.service("iRAppServer",class extends BaseApp{',
    '.service("iRAppLmu",class extends BaseApp{constructor($rootScope,$localStorage){super(...arguments),this.appName="lmu",$localStorage.$default({lmu:{enabled:!0}}),this.init()}}).run((function(iRAppLmu){}))' +
      '.service("iRAppServer",class extends BaseApp{',
    'app.js lmu bridge app'
  );
  // the settings page keeps each game's profiles under its own tab's storage key
  src = mustReplace(
    src,
    'updateURLDebounceTimeout;return $scope.settings=settings=null!=(base=null!=(base1=$localStorage.server)',
    'updateURLDebounceTimeout;return $scope.isLmu=$scope.state.current.name.startsWith("lmu"),$scope.settings=settings=null!=(base=null!=(base1=$localStorage[$scope.state.current.name.split(".")[0]])',
    'app.js racing overlay settings storage per game'
  );
  src = mustReplace(
    src,
    'v=`${settingsMain.host}:${d.hostPort}`',
    `v=\`\${settingsMain.host}:\${8182===d.hostPort&&isLmu?${LMU_PORT}:d.hostPort}\``,
    'app.js lmu widgets connect to the bridge'
  );
  src = mustReplace(
    src,
    'null==v||"object"!=typeof v||Array.isArray(v)||(v=JSON.stringify(v)),params.set(k,v)}return(res=params.toString()).length?',
    'isLmu&&k in kappsLmuSettings&&(v=kappsLmuSettings[k](v)),null==v||"object"!=typeof v||Array.isArray(v)||(v=JSON.stringify(v)),params.set(k,v)}return isLmu&&params.set("game","lmu"),(res=params.toString()).length?',
    'app.js lmu widget URL options'
  );
  // createURLParams' isLmu, and the same for each widget panel's template (app-settings has its own scope)
  src = mustReplace(src, 'createURLParams=function(keys,s,d){', 'createURLParams=function(keys,s,d){var isLmu=$scope.isLmu;', 'app.js createURLParams isLmu');
  // Standings' column editor gets the LMU view of the settings, so it offers LMU's columns only
  src = mustReplace(
    src,
    'electron.server.racingOverlay.openSettingsWindow(name,settingsStandings2.settings,',
    'electron.server.racingOverlay.openSettingsWindow(name,$scope.isLmu?kappsLmuSettings.settings(settingsStandings2.settings):settingsStandings2.settings,',
    'app.js lmu standings editor'
  );
  src = mustReplace(src, 'scope.storage=scope.$parent.storage,', 'scope.isLmu=scope.$parent.isLmu,scope.storage=scope.$parent.storage,', 'app.js widget panels isLmu');
  src = mustReplaceAll(
    src,
    'electron.server.racingOverlay.profilesChanged(settings.profiles,settings.customOverlays)',
    'electron.server.racingOverlay.profilesChanged(...kappsRacingOverlays($localStorage))',
    2,
    'app.js profilesChanged'
  );
  src = mustReplace(
    src,
    'ipcRenderer.send("racing-overlay-profiles-changed",racingOverlayProfiles,null!=racingOverlaySettings?racingOverlaySettings.customOverlays:void 0)',
    'ipcRenderer.send("racing-overlay-profiles-changed",...kappsRacingOverlays($localStorage))',
    'app.js profiles sent to the main process at startup'
  );
  return mustReplace(
    src,
    'if(racingOverlaySettings=null!=(ref1=$localStorage.server.racingOverlay)?ref1.settings:void 0,',
    'if(racingOverlaySettings=kappsRacingOverlaySettings($localStorage).find((function(s){return(s.profiles||[]).some((function(p){return p.id===profileId}))})),',
    'app.js overlay profile lookup across games'
  );
}

// The widget panels' options for those same LMU-less features (kappsLmuSettings), hidden on LMU's page.
const LMU_HIDDEN_OPTIONS = {
  sof: ['<!-- sof -->\r\n\t\t<div ng-if="settings.showInfo"', '<!-- sof -->\r\n\t\t<div ng-if="settings.showInfo && !isLmu"'],
  incidents: ['<!-- incidents -->\r\n\t\t<div ng-if="settings.showInfo"', '<!-- incidents -->\r\n\t\t<div ng-if="settings.showInfo && !isLmu"'],
  humidity: [
    '<label app-checkbox-flag ng-model="settings.trackInfoFlag" ng-change="saveSettings()" class="checkbox-inline">\r\n\t\t\t\t\t<input type="checkbox" value="2">',
    '<label ng-if="!isLmu" app-checkbox-flag ng-model="settings.trackInfoFlag" ng-change="saveSettings()" class="checkbox-inline">\r\n\t\t\t\t\t<input type="checkbox" value="2">',
  ],
  ratingGain: ['<!-- irating gain -->\r\n\t\t\t\t<label ng-if="settings.showSRiRBadges', '<!-- irating gain -->\r\n\t\t\t\t<label ng-if="!isLmu && settings.showSRiRBadges'],
};

function hideOptionsOnLmu(src, options, label) {
  for (const option of options) src = mustReplace(src, ...LMU_HIDDEN_OPTIONS[option], `${label} ${option} option`);
  return src;
}

// Stock Standings ignores the host in its URL: its worker reads h.host, but the value lives in h.params.host,
// so it always connected to the local iRacing server. Fixing that is also what points LMU's Standings at the bridge.
function patchStandingsWorkerHost(src) {
  return mustReplaceAll(src, 'h.host||`${location.hostname||"127.0.0.1"}:8182`', 'h.params.host||`${location.hostname||"127.0.0.1"}:8182`', 2, 'worker.js server address');
}

// LMU drivers have an empty license string until the bridge has a Safety Rating to put in it. Relatives
// and legacy Standings would fail on it and drop every driver after the first; skip the badge instead.
function skipMissingLicense(src, condition, label) {
  return mustReplace(src, `${condition})switch(car.safetyRatingClass=d.LicString[0]`, `${condition}&&d.LicString)switch(car.safetyRatingClass=d.LicString[0]`, label + ' empty license');
}

// Standings colours the license badge by its class letter and number (failing on an empty one) and shows a
// missing iRating as "0.0k": reveal each badge only when there's a rating to show.
function patchStandingsMissingRatings(src) {
  for (const rating of ['srating', 'erating']) {
    const reveal = `this.data._reveal.${rating}&&(a=this.dataContentEls.get("${rating}"))`;
    src = mustReplace(src, reveal, `this.data.${rating}&&${reveal}`, `standings.js empty ${rating}`);
  }
  return src;
}

// Standings: Damage, Fuel/VE and Tyres columns, from the bridge's per-car telemetry arrays (LMU shares both for every
// car; iRacing for none, so its column editor doesn't offer them). Wired like the Country Flag column.
// value: the worker's value for car e from the array v (primitive, so an unchanged one isn't resent; Fuel/VE
// is "ve"-prefixed for virtual energy); apply: how the page writes value I into the column's element r;
// sample: a made-up value for test mode's driver l
const LMU_COLUMNS = [
  { className: 'lmu-damage', name: 'lmuDamage', field: 'CarIdxLmuDamage', chip: 'DMG', value: 'v[e]>0?v[e]:null', apply: 'r.textContent=I?I+"%":""', sample: 'Math.random()>.7?Math.ceil(40*Math.random()):null' },
  { className: 'lmu-energy', name: 'lmuEnergy', field: 'CarIdxLmuEnergy', chip: 'FUEL', value: 'null==v[e]||v[e]<0?null:(i.driverInfo.LmuVe?"ve":"")+v[e]', apply: 'r.textContent=null==I?"":I.replace("ve","")+"%",r.classList.toggle("ve",!!I&&I.startsWith("ve"))', sample: '(l.classIndex?"":"ve")+Math.round(15+80*Math.random())' },
  // each wheel's compound digit (front left, front right, rear left, rear right; 0 soft, 1 medium, 2 hard, 3 wet) as a dot
  { className: 'lmu-tyres', name: 'lmuTyres', field: 'CarIdxLmuTyres', chip: 'TYRES', value: 'v[e]||null', apply: 'r.innerHTML=I?I.replace(/./g,"<i class=c$&></i>"):""', sample: '["1111","0022","2222","3333"][l.classIndex%4]' },
];
const LMU_CHIP_WIDTH = 40;

// LMU overlays' workers also subscribe to the arrays and copy each car's value into its data
function patchWorkerLmuColumns(src) {
  const vars = JSON.stringify(LMU_COLUMNS.map((c) => c.field));
  src = mustReplace(src, '"name","countryFlag",', `"name","countryFlag",${LMU_COLUMNS.map((c) => `"${c.name}",`).join('')}`, 'worker.js mainKeys lmu columns');
  src = mustReplace(src, '"TrackWetness","WeatherDeclaredWet"],["WeekendInfo"]', `"TrackWetness","WeatherDeclaredWet"].concat(h.settings.lmu?${vars}:[]),["WeekendInfo"]`, 'worker.js lmu telemetry vars');
  const set = LMU_COLUMNS.map((c) => `v=C.${c.field}||[],i.${c.name}=${c.value}`).join(',');
  return mustReplace(src, 'C=R.getData(),', `C=R.getData(),h.settings.lmu&&R.watch(${vars},function(){var e,i,v;for([e,{data:i}]of c)i&&(${set})}),`, 'worker.js lmu telemetry watch');
}

function patchStandingsJsLmuColumns(src) {
  const apply = LMU_COLUMNS.map((c) => `this.dataContentEls.has("${c.name}")&&this.data._apply.${c.name}&&([I,C,r]=this.getApplyData("${c.name}"),${c.apply}),`).join('');
  src = mustReplace(src, 'this.dataContentEls.has("countryFlag")&&', apply + 'this.dataContentEls.has("countryFlag")&&', 'standings.js apply() lmu columns');
  // test mode's made-up drivers (the editor's preview)
  const sample = 'l.tyreCompound=[0,1,2][Math.round(2*Math.random())],';
  return mustReplace(src, sample, sample + LMU_COLUMNS.map((c) => `l.${c.name}=${c.sample},`).join(''), 'standings.js test data lmu columns');
}

// Fuel Calculator: for an LMU car that runs on virtual energy (the bridge's LmuVe), it works in percent of VE
// instead of litres of fuel, as that's what runs out and what LMU's pit menu refills. Its fast telemetry gets
// kappsFuel/kappsTank/kappsVe, read where it read FuelLevel and the tank size; getters, so they always follow
// the latest telemetry, and non-enumerable, so code clearing the data's keys leaves them.
function patchFuelCalcJsLmuEnergy(src) {
  src = mustReplace(src, '"FuelLevel","PitSvFlags","PitSvFuel"', '"FuelLevel","PitSvFlags","PitSvFuel","LmuVirtualEnergy"', 'fuel-calc.js lmu energy telemetry');
  // (before the getters, whose tank size reads the same)
  src = mustReplaceAll(src, 'irFast.FuelLevel', 'irFast.kappsFuel', 8, 'fuel-calc.js fuel level reads');
  src = mustReplaceAll(src, 'ir.DriverInfo.DriverCarFuelMaxLtr*ir.DriverInfo.DriverCarMaxFuelPct', 'irFast.kappsTank', 2, 'fuel-calc.js tank size reads');
  src = mustReplace(
    src,
    'ir=scope.ir,irFast=scope.irFast,',
    'ir=scope.ir,irFast=scope.irFast,Object.defineProperties(irFast,{' +
      'kappsVe:{configurable:!0,get:function(){var d=ir.DriverInfo&&ir.DriversByCarIdx[ir.DriverInfo.DriverCarIdx];return!!(d&&d.LmuVe)}},' +
      'kappsFuel:{configurable:!0,get:function(){return this.kappsVe?null==this.LmuVirtualEnergy?null:100*this.LmuVirtualEnergy:this.FuelLevel}},' +
      'kappsTank:{configurable:!0,get:function(){return this.kappsVe?100:ir.DriverInfo.DriverCarFuelMaxLtr*ir.DriverInfo.DriverCarMaxFuelPct}}}),',
    'fuel-calc.js lmu energy source'
  );
  // percent of VE has no units to convert
  src = mustReplace(src, 'scope.normalize=function(fuel){', 'scope.normalize=function(fuel){if(irFast.kappsVe)return fuel;', 'fuel-calc.js lmu energy normalize');
  return mustReplace(src, 'scope.reverseNormalize=function(fuel){', 'scope.reverseNormalize=function(fuel){if(irFast.kappsVe)return fuel;', 'fuel-calc.js lmu energy reverseNormalize');
}

function patchFuelCalcHtmlLmuEnergy(src) {
  return mustReplace(src, '<div class="header">Fuel Level</div>', '<div ng-bind="irFast.kappsVe ? \'Energy %\' : \'Fuel Level\'" class="header">Fuel Level</div>', 'fuel-calc.html lmu energy label');
}

function patchIndexHtmlLmuColumns(src) {
  const cells = LMU_COLUMNS.map((c) => `\t\t\t\t<div class="${c.className}">\r\n\t\t\t\t\t<div class="content mono" data-column="${c.className}" data-content="${c.name}"></div>\r\n\t\t\t\t</div>\r\n`).join('');
  return mustReplace(src, '\t\t\t\t<div class="tyre-compound">', cells + '\t\t\t\t<div class="tyre-compound">', 'index.html lmu columns');
}

function patchStandingsCssLmuColumns(src) {
  // the content is measured for the column's width, so it mustn't be sized by the column
  const rule = LMU_COLUMNS.map((c) => `.rows > .row.driver > .wrap > div.${c.className}{width:var(--column-width-${c.className})}.rows > .row.driver > .wrap > div.${c.className} > .content{position:absolute;right:0;padding-left:calc(var(--padding) * 2)}`).join('') +
    '.rows > .row.driver > .wrap > div.lmu-damage > .content{color:#ff7a66}.rows > .row.driver > .wrap > div.lmu-energy > .content.ve{color:#66d4ff}' +
    // the tyres in a square, coloured like Standings' Tyre Compound
    '.rows > .row.driver > .wrap > div.lmu-tyres > .content{top:0;bottom:0;display:grid;grid-template-columns:repeat(2,calc(var(--height) * .3));align-content:center;gap:calc(var(--height) * .08)}' +
    '.lmu-tyres i{height:calc(var(--height) * .3);border-radius:50%}.lmu-tyres i.c0{background:#eb6347}.lmu-tyres i.c1{background:#e5e600}.lmu-tyres i.c2{background:#e6e6e6}.lmu-tyres i.c3{background:#55a6f6}';
  if (src.includes(rule)) throw new Error('standings.css already contains the LMU column rules — patch already applied?');
  return src + rule;
}

function patchSettingsJsLmuColumns(src) {
  src = mustReplace(src, '{"className":"country-flag","name":"countryFlag","width":25},', LMU_COLUMNS.map((c) => `{"className":"${c.className}","name":"${c.name}","width":${LMU_CHIP_WIDTH}},`).join('') + '{"className":"country-flag","name":"countryFlag","width":25},', 'settings.js flat column registry lmu columns');
  // only the chips for the game being edited: LMU's editor is opened with kappsLmuSettings.settings, so lmu:true
  const hidden = `(this.data.lmu?${JSON.stringify(LMU_DROPPED_COLUMNS)}[Be]:${JSON.stringify(LMU_COLUMNS.map((c) => c.className))})`;
  return mustReplace(src, 'if(M=He[O],"driver"!==Be||"gapInt"!==M.name){', `if(M=He[O],("driver"!==Be||"gapInt"!==M.name)&&!${hidden}.includes(M.className)){`, 'settings.js chips per game');
}

// the editor's drag-and-drop chips: a dark tile labelled like the column
function patchSettingsCssLmuColumns(src) {
  const chip = (label) => `data:image/svg+xml;base64,${Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${LMU_CHIP_WIDTH}" height="25"><text x="50%" y="17" text-anchor="middle" font-family="Roboto,sans-serif" font-size="11" font-weight="700" fill="#fff">${label}</text></svg>`).toString('base64')}`;
  const rule = LMU_COLUMNS.map((c) => `.atlas.driver.${c.className}{width:${LMU_CHIP_WIDTH}px;height:25px;background-color:#000;background-image:url(${chip(c.chip)});border-radius:2px}`).join('');
  if (src.includes(rule)) throw new Error('settings.css already contains the LMU column chips — patch already applied?');
  return src + rule;
}

function patchAppsListHtml(src) {
  const server = '<div ui-sref="server" ui-sref-active="selected" enable-app="server" class="app-item server"></div>';
  return mustReplace(src, server, server + '\r\n\t\t\t<div ui-sref="lmu" ui-sref-active="selected" class="app-item lmu"></div>', 'apps.html lmu tab');
}

const LMU_SIDEBAR_HTML = `<header>
\t<div class="drag"></div>
\t<span class="flex-spacer title">Le Mans Ultimate</span>
</header>
<div class="scroller-wrap dark">
\t<div class="scroller">
\t\t<div ui-sref=".racing-overlay" ui-sref-active="selected" class="app-item">Racing Overlay</div>
\t\t<div ui-sref=".about" ui-sref-active="selected" class="app-item">About</div>
\t</div>
</div>
`;

const LMU_ABOUT_HTML = `<div class="container-fluid">
\t<div class="row about">
\t\t<div class="col-md-12">

\t\t\t<xmp app-markdown>
\t\t\t## Le Mans Ultimate

\t\t\tKapps' Racing Overlay for Le Mans Ultimate: the same widgets as iRacing's, with their own profiles and layout. Set them up under **Racing Overlay**.

\t\t\t## Requirements

\t\t\tIn Le Mans Ultimate, turn on **Settings → Gameplay → Enable Plugins**. That is what lets Kapps read the game's telemetry.

\t\t\t## Differences from iRacing

\t\t\t- Le Mans Ultimate doesn't share driver nationality, so there are no country flags.
\t\t\t- There is no wind in Le Mans Ultimate, so Weather's wind row stays empty.
\t\t\t- Track Map is iRacing-only. Tyres shows live tread temperatures and pressures.
\t\t\t- Standings has no Rating column yet: Le Mans Ultimate's Safety and Driver Ratings aren't available to Kapps.
\t\t\t- Standings' **Tyres** column shows each wheel's compound, since Le Mans Ultimate allows mixing them, in place of iRacing's Tyre Compound column.
\t\t\t- Le Mans Ultimate shares no start lights: Flags shows READY for the countdown, then GREEN.
\t\t\t- The Delta Bar compares against your best lap only.
\t\t\t</xmp>
\t\t</div>
\t</div>
</div>
`;

// Run by Kapps' bundled Python 3.10 (see the section comment). Kept in a String.raw literal: it must not
// contain backticks or "${".
const LMU_BRIDGE_PY = String.raw`"""Le Mans Ultimate bridge for Kapps (Kapps community patch).

Reads Le Mans Ultimate's built-in shared memory ("LMU_Data", needs Settings > Gameplay > Enable Plugins)
and serves it over the same WebSocket protocol as Kapps' iRacing server (server.exe), translated into
iRacing's variable names, so Kapps' overlays can show LMU data unchanged. It runs on Kapps' bundled
Python as lmu.exe, a copy of Kapps' own launcher, which imports this file.

The shared memory layout is LMU's SharedMemoryInterface.hpp; it is checked against the sizes and offsets
published by pyLMUSharedMemory (MIT) when this starts.
"""
import argparse
import ctypes
import json
import logging
import logging.handlers
import math
import re
import time
import zlib
from ctypes import c_bool, c_byte, c_char, c_double, c_float, c_int, c_short, c_ubyte, c_uint, c_ulonglong, c_ushort
from tornado import ioloop, web, websocket

MAX_VEHICLES = 104
TICK_MS = 1000 / 60


class Struct(ctypes.Structure):
    _pack_ = 4


class Vect3(Struct):
    _fields_ = [('x', c_double), ('y', c_double), ('z', c_double)]


class Wheel(Struct):
    _fields_ = [
        ('mSuspensionDeflection', c_double), ('mRideHeight', c_double), ('mSuspForce', c_double),
        ('mBrakeTemp', c_double), ('mBrakePressure', c_double), ('mRotation', c_double),
        ('mLateralPatchVel', c_double), ('mLongitudinalPatchVel', c_double), ('mLateralGroundVel', c_double),
        ('mLongitudinalGroundVel', c_double), ('mCamber', c_double), ('mLateralForce', c_double),
        ('mLongitudinalForce', c_double), ('mTireLoad', c_double), ('mGripFract', c_double),
        ('mPressure', c_double), ('mTemperature', c_double * 3), ('mWear', c_double),
        ('mTerrainName', c_char * 16), ('mSurfaceType', c_ubyte), ('mFlat', c_bool), ('mDetached', c_bool),
        ('mStaticUndeflectedRadius', c_ubyte), ('mVerticalTireDeflection', c_double), ('mWheelYLocation', c_double),
        ('mToe', c_double), ('mTireCarcassTemperature', c_double), ('mTireInnerLayerTemperature', c_double * 3),
        ('mOptimalTemp', c_float), ('mCompoundIndex', c_ubyte), ('mCompoundType', c_ubyte), ('mExpansion', c_ubyte * 18),
    ]


class VehicleTelemetry(Struct):
    _fields_ = [
        ('mID', c_int), ('mDeltaTime', c_double), ('mElapsedTime', c_double), ('mLapNumber', c_int),
        ('mLapStartET', c_double), ('mVehicleName', c_char * 64), ('mTrackName', c_char * 64),
        ('mPos', Vect3), ('mLocalVel', Vect3), ('mLocalAccel', Vect3), ('mOri', Vect3 * 3), ('mLocalRot', Vect3),
        ('mLocalRotAccel', Vect3), ('mGear', c_int), ('mEngineRPM', c_double), ('mEngineWaterTemp', c_double),
        ('mEngineOilTemp', c_double), ('mClutchRPM', c_double), ('mUnfilteredThrottle', c_double),
        ('mUnfilteredBrake', c_double), ('mUnfilteredSteering', c_double), ('mUnfilteredClutch', c_double),
        ('mFilteredThrottle', c_double), ('mFilteredBrake', c_double), ('mFilteredSteering', c_double),
        ('mFilteredClutch', c_double), ('mSteeringShaftTorque', c_double), ('mFront3rdDeflection', c_double),
        ('mRear3rdDeflection', c_double), ('mFrontWingHeight', c_double), ('mFrontRideHeight', c_double),
        ('mRearRideHeight', c_double), ('mDrag', c_double), ('mFrontDownforce', c_double), ('mRearDownforce', c_double),
        ('mFuel', c_double), ('mEngineMaxRPM', c_double), ('mScheduledStops', c_ubyte), ('mOverheating', c_bool),
        ('mDetached', c_bool), ('mHeadlights', c_bool), ('mDentSeverity', c_ubyte * 8), ('mLastImpactET', c_double),
        ('mLastImpactMagnitude', c_double), ('mLastImpactPos', Vect3), ('mEngineTorque', c_double),
        ('mCurrentSector', c_int), ('mSpeedLimiter', c_ubyte), ('mMaxGears', c_ubyte),
        ('mFrontTireCompoundIndex', c_ubyte), ('mRearTireCompoundIndex', c_ubyte), ('mFuelCapacity', c_double),
        ('mFrontFlapActivated', c_ubyte), ('mRearFlapActivated', c_ubyte), ('mRearFlapLegalStatus', c_ubyte),
        ('mIgnitionStarter', c_ubyte), ('mFrontTireCompoundName', c_char * 18), ('mRearTireCompoundName', c_char * 18),
        ('mSpeedLimiterAvailable', c_ubyte), ('mAntiStallActivated', c_ubyte), ('mUnused', c_ubyte * 2),
        ('mVisualSteeringWheelRange', c_float), ('mRearBrakeBias', c_double), ('mTurboBoostPressure', c_double),
        ('mPhysicsToGraphicsOffset', c_float * 3), ('mPhysicalSteeringWheelRange', c_float), ('mDeltaBest', c_double),
        ('mBatteryChargeFraction', c_double), ('mElectricBoostMotorTorque', c_double),
        ('mElectricBoostMotorRPM', c_double), ('mElectricBoostMotorTemperature', c_double),
        ('mElectricBoostWaterTemperature', c_double), ('mElectricBoostMotorState', c_ubyte),
        ('mLapInvalidated', c_bool), ('mABSActive', c_bool), ('mTCActive', c_bool), ('mSpeedLimiterActive', c_bool),
        ('mWiperState', c_ubyte), ('mTC', c_ubyte), ('mTCMax', c_ubyte), ('mTCSlip', c_ubyte), ('mTCSlipMax', c_ubyte),
        ('mTCCut', c_ubyte), ('mTCCutMax', c_ubyte), ('mABS', c_ubyte), ('mABSMax', c_ubyte), ('mMotorMap', c_ubyte),
        ('mMotorMapMax', c_ubyte), ('mMigration', c_ubyte), ('mMigrationMax', c_ubyte), ('mFrontAntiSway', c_ubyte),
        ('mFrontAntiSwayMax', c_ubyte), ('mRearAntiSway', c_ubyte), ('mRearAntiSwayMax', c_ubyte),
        ('mLiftAndCoastProgress', c_ubyte), ('mTrackLimitsSteps', c_ubyte), ('mRegen', c_float),
        ('mStateOfCharge', c_float), ('mVirtualEnergy', c_float), ('mTimeGapCarAhead', c_float),
        ('mTimeGapCarBehind', c_float), ('mTimeGapPlaceAhead', c_float), ('mTimeGapPlaceBehind', c_float),
        ('mVehicleModel', c_char * 30), ('mVehicleClass', c_ubyte), ('mVehicleChampionship', c_ubyte),
        ('mExpansion', c_ubyte * 20), ('mWheels', Wheel * 4),
    ]


class VehicleScoring(Struct):
    _fields_ = [
        ('mID', c_int), ('mDriverName', c_char * 32), ('mVehicleName', c_char * 64), ('mTotalLaps', c_short),
        ('mSector', c_byte), ('mFinishStatus', c_byte), ('mLapDist', c_double), ('mPathLateral', c_double),
        ('mTrackEdge', c_double), ('mBestSector1', c_double), ('mBestSector2', c_double), ('mBestLapTime', c_double),
        ('mLastSector1', c_double), ('mLastSector2', c_double), ('mLastLapTime', c_double), ('mCurSector1', c_double),
        ('mCurSector2', c_double), ('mNumPitstops', c_short), ('mNumPenalties', c_short), ('mIsPlayer', c_bool),
        ('mControl', c_byte), ('mInPits', c_bool), ('mPlace', c_ubyte), ('mVehicleClass', c_char * 32),
        ('mTimeBehindNext', c_double), ('mLapsBehindNext', c_int), ('mTimeBehindLeader', c_double),
        ('mLapsBehindLeader', c_int), ('mLapStartET', c_double), ('mPos', Vect3), ('mLocalVel', Vect3),
        ('mLocalAccel', Vect3), ('mOri', Vect3 * 3), ('mLocalRot', Vect3), ('mLocalRotAccel', Vect3),
        ('mHeadlights', c_ubyte), ('mPitState', c_ubyte), ('mServerScored', c_ubyte), ('mIndividualPhase', c_ubyte),
        ('mQualification', c_int), ('mTimeIntoLap', c_double), ('mEstimatedLapTime', c_double),
        ('mPitGroup', c_char * 24), ('mFlag', c_ubyte), ('mUnderYellow', c_bool), ('mCountLapFlag', c_ubyte),
        ('mInGarageStall', c_bool), ('mUpgradePack', c_ubyte * 16), ('mPitLapDist', c_float),
        ('mBestLapSector1', c_float), ('mBestLapSector2', c_float), ('mSteamID', c_ulonglong),
        ('mVehFilename', c_char * 32), ('mAttackMode', c_short), ('mFuelFraction', c_ubyte), ('mDRSState', c_bool),
        ('mExpansion', c_ubyte * 4),
    ]


class ScoringInfo(Struct):
    _fields_ = [
        ('mTrackName', c_char * 64), ('mSession', c_int), ('mCurrentET', c_double), ('mEndET', c_double),
        ('mMaxLaps', c_int), ('mLapDist', c_double), ('mResultsStreamPointer', c_ubyte * 8), ('mNumVehicles', c_int),
        ('mGamePhase', c_ubyte), ('mYellowFlagState', c_byte), ('mSectorFlag', c_ubyte * 3), ('mStartLight', c_ubyte),
        ('mNumRedLights', c_ubyte), ('mInRealtime', c_bool), ('mPlayerName', c_char * 32), ('mPlrFileName', c_char * 64),
        ('mDarkCloud', c_double), ('mRaining', c_double), ('mAmbientTemp', c_double), ('mTrackTemp', c_double),
        ('mWind', Vect3), ('mMinPathWetness', c_double), ('mMaxPathWetness', c_double), ('mGameMode', c_ubyte),
        ('mIsPasswordProtected', c_bool), ('mServerPort', c_ushort), ('mServerPublicIP', c_uint), ('mMaxPlayers', c_int),
        ('mServerName', c_char * 32), ('mStartET', c_float), ('mAvgPathWetness', c_double),
        ('mSessionTimeRemaining', c_float), ('mTimeOfDay', c_float), ('mIsFixedSetup', c_bool),
        ('mTrackGripLevel', c_ubyte), ('mCloudCoverage', c_ubyte), ('mTrackLimitsStepsPerPenalty', c_ubyte),
        ('mTrackLimitsStepsPerPoint', c_ubyte), ('mExpansion', c_ubyte * 187), ('mVehiclePointer', c_ubyte * 8),
    ]


class Events(Struct):
    _fields_ = [(name, c_uint) for name in (
        'SME_ENTER', 'SME_EXIT', 'SME_STARTUP', 'SME_SHUTDOWN', 'SME_LOAD', 'SME_UNLOAD', 'SME_START_SESSION',
        'SME_END_SESSION', 'SME_ENTER_REALTIME', 'SME_EXIT_REALTIME', 'SME_UPDATE_SCORING', 'SME_UPDATE_TELEMETRY',
        'SME_INIT_APPLICATION', 'SME_UNINIT_APPLICATION', 'SME_SET_ENVIRONMENT', 'SME_FFB')]


class Generic(Struct):
    _fields_ = [('events', Events), ('gameVersion', c_int), ('FFBTorque', c_float), ('appInfo', c_ubyte * 260)]


class ScoringData(Struct):
    _fields_ = [('scoringInfo', ScoringInfo), ('scoringStreamSize', c_ubyte * 12),
                ('vehScoringInfo', VehicleScoring * MAX_VEHICLES), ('scoringStream', c_char * 65536)]


class TelemetryData(Struct):
    _fields_ = [('activeVehicles', c_ubyte), ('playerVehicleIdx', c_ubyte), ('playerHasVehicle', c_bool),
                ('telemInfo', VehicleTelemetry * MAX_VEHICLES)]


class LmuData(Struct):
    _fields_ = [('generic', Generic), ('paths', c_char * 1300), ('scoring', ScoringData), ('telemetry', TelemetryData)]


# Published sizes/offsets (pyLMUSharedMemory); a mismatch means the layout above was mistyped.
for struct, size in ((Vect3, 24), (Wheel, 260), (VehicleTelemetry, 1888), (VehicleScoring, 584), (ScoringInfo, 548),
                     (Generic, 332), (ScoringData, 126832), (TelemetryData, 196356), (LmuData, 324820)):
    assert ctypes.sizeof(struct) == size, (struct.__name__, ctypes.sizeof(struct), size)
assert VehicleTelemetry.mWheels.offset == 848 and VehicleTelemetry.mVirtualEnergy.offset == 776
assert VehicleScoring.mPlace.offset == 199 and VehicleScoring.mSteamID.offset == 536
assert ScoringInfo.mAvgPathWetness.offset == 332 and LmuData.telemetry.offset == 128464


class SharedMemory:
    """Read-only view of LMU_Data. Uses OpenFileMapping, so it never creates the block when LMU isn't
    running (mmap with a tagname would), and is reopened every few seconds: a handle held open keeps the
    block, frozen, alive after LMU quits."""

    FILE_MAP_READ = 4

    def __init__(self):
        k32 = ctypes.WinDLL('kernel32', use_last_error=True)
        k32.OpenFileMappingW.restype = ctypes.c_void_p
        k32.OpenFileMappingW.argtypes = [ctypes.c_uint32, c_bool, ctypes.c_wchar_p]
        k32.MapViewOfFile.restype = ctypes.c_void_p
        k32.MapViewOfFile.argtypes = [ctypes.c_void_p, ctypes.c_uint32, ctypes.c_uint32, ctypes.c_uint32, ctypes.c_size_t]
        k32.UnmapViewOfFile.argtypes = [ctypes.c_void_p]
        k32.CloseHandle.argtypes = [ctypes.c_void_p]
        self.k32 = k32
        self.handle = self.view = None
        self.buffer = bytearray(ctypes.sizeof(LmuData))
        self.data = LmuData.from_buffer(self.buffer)

    def open(self):
        self.close()
        handle = self.k32.OpenFileMappingW(self.FILE_MAP_READ, False, 'LMU_Data')
        if not handle:
            return False
        view = self.k32.MapViewOfFile(handle, self.FILE_MAP_READ, 0, 0, len(self.buffer))
        if not view:
            self.k32.CloseHandle(handle)
            return False
        self.handle, self.view = handle, view
        return True

    def close(self):
        if self.view:
            self.k32.UnmapViewOfFile(self.view)
        if self.handle:
            self.k32.CloseHandle(self.handle)
        self.handle = self.view = None

    def update(self):
        """Copy the live block into self.data, but only a consistent one: LMU has no torn-read guard, so
        like TinyPedal only copy right after an update when scoring and telemetry agree on the car count."""
        live = LmuData.from_address(self.view)
        events = live.generic.events
        if (events.SME_UPDATE_SCORING or events.SME_UPDATE_TELEMETRY) and \
                live.scoring.scoringInfo.mNumVehicles == live.telemetry.activeVehicles:
            ctypes.memmove(ctypes.addressof(self.data), self.view, len(self.buffer))


def text(raw):
    return raw.decode('utf-8', 'replace').rstrip('\x00')


def stable_id(name, base):
    """A stable number for a name LMU only gives as text (track, car, class), kept clear of iRacing's
    own small ids so id-specific features in Kapps don't misfire."""
    return base + zlib.crc32(name.encode()) % base


# LMU has no class colours. Kapps' Standings tells classes apart by colour, from iRacing's palette (any other
# colour, white included, counting as its first) and orders them by it, so classes take palette colours in
# speed order, LMP2 blue and LMGT3 green as in the WEC.
PALETTE = (0xFFDA59, 0x33CEFF, 0xFF5888, 0xAE6BFF, 0x53FF77, 0xD35400)
CLASSES = {
    'Hyper': ('HYPER', PALETTE[0]), 'Hypercar': ('HYPER', PALETTE[0]), 'LMP2': ('LMP2', PALETTE[1]),
    'LMP2_ELMS': ('LMP2', PALETTE[2]), 'LMP3': ('LMP3', PALETTE[3]), 'GT3': ('LMGT3', PALETTE[4]), 'GTE': ('GTE', PALETTE[5]),
}


# iRacing's TrackWetness scale (1 dry .. 7 extremely wet) from LMU's 0..1 path wetness.
WETNESS_STEPS = (0.02, 0.1, 0.2, 0.35, 0.55, 0.8)
# iRacing SessionState from LMU's mGamePhase: 1 get in car, 2 warmup, 3 parade, 4 racing, 5 checkered.
SESSION_STATES = {0: 1, 1: 2, 2: 2, 3: 3, 4: 3, 5: 4, 6: 4, 7: 4, 8: 5, 9: 4}
OFF_TRACK, IN_PIT_STALL, APPROACHING_PITS, ON_TRACK = 0, 1, 2, 3


def session_type(session):
    return 'Race' if session >= 10 else 'Warmup' if session == 9 else 'Qualify' if session >= 5 \
        else 'Practice' if session >= 1 else 'Test'


def abbrev(name):
    parts = name.split()
    return '%s, %s' % (parts[-1], parts[0][0]) if len(parts) > 1 else name


class Lmu:
    """One consistent LMU snapshot, translated into iRacing's telemetry variables and session info."""

    def __init__(self):
        self.memory = SharedMemory()
        self.connected = False
        self.last_et = None
        self.et_changed_at = 0
        self.tick = 0
        self.session_info = {}          # key -> (version, value)
        self.best_lap = {}              # car mID -> lap its best time was set on
        self.class_colours = {}         # class -> (short name, colour) this session; see class_info
        self.class_session = None
        self.ve_cars = set()            # (mID, vehicle) of cars that have reported virtual energy; mIDs are
                                        # reused by other cars in later sessions

    def poll(self):
        """Reopen the block (detects LMU quitting) and report whether a session with a player is running."""
        if not self.memory.open():
            return False
        self.memory.update()
        info = self.memory.data.scoring.scoringInfo
        if info.mCurrentET != self.last_et:
            self.last_et, self.et_changed_at = info.mCurrentET, time.monotonic()
        return info.mNumVehicles > 0 and self.player() is not None

    def update(self):
        self.memory.update()
        self.tick += 1

    def cars(self):
        """(scoring, telemetry) per car, telemetry matched by mID: the two arrays aren't in the same order."""
        scoring, telemetry = self.memory.data.scoring, self.memory.data.telemetry
        n = min(scoring.scoringInfo.mNumVehicles, MAX_VEHICLES)
        tele = {telemetry.telemInfo[i].mID: telemetry.telemInfo[i] for i in range(n)}
        return [(scoring.vehScoringInfo[i], tele.get(scoring.vehScoringInfo[i].mID)) for i in range(n)]

    def player(self):
        for scor, tele in self.cars():
            if scor.mIsPlayer:
                return scor, tele
        return None

    # --- telemetry ---------------------------------------------------------------------------------

    def telemetry(self):
        info = self.memory.data.scoring.scoringInfo
        cars = self.cars()
        scor, tele = self.player() or (None, None)
        size = max([64] + [s.mID + 1 for s, _ in cars])
        lap_length = info.mLapDist or 1
        arrays = {k: [-1] * size for k in ('CarIdxLap', 'CarIdxLapCompleted', 'CarIdxLapDistPct', 'CarIdxPosition',
                                           'CarIdxClassPosition', 'CarIdxTrackSurface', 'CarIdxBestLapTime',
                                           'CarIdxLastLapTime', 'CarIdxEstTime', 'CarIdxGear', 'CarIdxRPM',
                                           'CarIdxLmuDamage', 'CarIdxLmuEnergy')}
        arrays['CarIdxOnPitRoad'] = [False] * size
        arrays['CarIdxLmuTyres'] = [''] * size
        for (s, t), class_pos in zip(cars, self.class_positions(cars)):
            i = s.mID
            done = max(s.mTotalLaps, t.mLapNumber if t else 0)
            arrays['CarIdxLapCompleted'][i] = done
            arrays['CarIdxLap'][i] = done + 1
            arrays['CarIdxLapDistPct'][i] = min(max(s.mLapDist / lap_length, 0), 1)
            arrays['CarIdxPosition'][i] = s.mPlace
            arrays['CarIdxClassPosition'][i] = class_pos
            arrays['CarIdxTrackSurface'][i] = self.surface(s, t)
            arrays['CarIdxOnPitRoad'][i] = bool(s.mInPits)
            arrays['CarIdxBestLapTime'][i] = s.mBestLapTime if s.mBestLapTime > 0 else -1
            arrays['CarIdxLastLapTime'][i] = s.mLastLapTime if s.mLastLapTime > 0 else -1
            arrays['CarIdxEstTime'][i] = s.mTimeIntoLap
            # LMU only, for Standings' Damage and Fuel/VE columns (whole percent) and Tyres column
            arrays['CarIdxLmuEnergy'][i] = self.energy(s, t)
            if t:
                arrays['CarIdxGear'][i] = t.mGear
                arrays['CarIdxRPM'][i] = t.mEngineRPM
                arrays['CarIdxLmuDamage'][i] = self.damage(t)
                # each wheel's compound (front left, front right, rear left, rear right; LMU allows mixing them):
                # 0 soft, 1 medium, 2 hard, 3 wet
                arrays['CarIdxLmuTyres'][i] = ''.join(str(w.mCompoundType) for w in t.mWheels)
        data = dict(arrays)
        data.update({
            'SessionTime': info.mCurrentET,
            'SessionTimeRemain': max(info.mEndET - info.mCurrentET, 0) if info.mEndET > 0 else 604800,
            'SessionTimeOfDay': info.mTimeOfDay,
            'SessionNum': 0,
            'SessionState': SESSION_STATES.get(info.mGamePhase, 4),
            'SessionFlags': self.session_flags(info, scor),
            'SessionTick': self.tick,
            'DisplayUnits': 1,
            'AirTemp': info.mAmbientTemp,
            'TrackTemp': info.mTrackTemp,
            'TrackTempCrew': info.mTrackTemp,
            'TrackWetness': self.wetness(info),
            'Precipitation': info.mRaining,
            'Skies': min(info.mCloudCoverage * 4 // 11, 3),
            'WeatherDeclaredWet': False,
            'PitsOpen': info.mGamePhase > 0 and info.mYellowFlagState != 2,     # 2: pits closed (full-course yellow)
            'IsReplayPlaying': False,
        })
        if scor is None or tele is None:
            return data
        speed = math.sqrt(tele.mLocalVel.x ** 2 + tele.mLocalVel.y ** 2 + tele.mLocalVel.z ** 2)
        steer_range = math.radians(tele.mPhysicalSteeringWheelRange or 540)
        data.update({
            'CamCarIdx': scor.mID,
            'IsOnTrack': bool(info.mInRealtime and not scor.mInGarageStall),
            'IsInGarage': bool(scor.mInGarageStall),
            'OnPitRoad': bool(scor.mInPits),
            'PlayerCarInPitStall': scor.mPitState == 3,
            'PlayerTrackSurface': data['CarIdxTrackSurface'][scor.mID],
            'Lap': data['CarIdxLap'][scor.mID],
            'LapCompleted': data['CarIdxLapCompleted'][scor.mID],
            'LapDist': scor.mLapDist,
            'LapDistPct': data['CarIdxLapDistPct'][scor.mID],
            'LapCurrentLapTime': tele.mElapsedTime - tele.mLapStartET,
            'LapLastLapTime': data['CarIdxLastLapTime'][scor.mID],
            'LapBestLapTime': data['CarIdxBestLapTime'][scor.mID],
            'LapDeltaToBestLap': tele.mDeltaBest,
            'Speed': speed,
            'Gear': tele.mGear,
            'RPM': tele.mEngineRPM,
            'Throttle': tele.mFilteredThrottle,
            'ThrottleRaw': tele.mUnfilteredThrottle,
            'Brake': tele.mFilteredBrake,
            'BrakeRaw': tele.mUnfilteredBrake,
            # iRacing's clutch is 1 when engaged (pedal up); LMU's is 1 with the pedal pressed
            'Clutch': 1 - tele.mFilteredClutch,
            'ClutchRaw': 1 - tele.mUnfilteredClutch,
            'HandbrakeRaw': 0,
            'BrakeABSactive': bool(tele.mABSActive),
            # iRacing: radians, positive turning left; LMU: -1 (left) .. 1 (right) of the wheel's range
            'SteeringWheelAngle': -tele.mUnfilteredSteering * steer_range / 2,
            'FuelLevel': tele.mFuel,
            'FuelLevelPct': tele.mFuel / tele.mFuelCapacity if tele.mFuelCapacity else 0,
            'OilTemp': tele.mEngineOilTemp,
            'WaterTemp': tele.mEngineWaterTemp,
            'EngineWarnings': (16 if tele.mSpeedLimiterActive else 0) | (1 if tele.mOverheating else 0),
            'dcBrakeBias': (1 - tele.mRearBrakeBias) * 100,
            'EnergyERSBatteryPct': tele.mBatteryChargeFraction,
            'CarLeftRight': self.car_left_right(scor, tele, cars),
            # LMU only: virtual energy (0..1; 0 for classes without it, e.g. LMP2)
            'LmuVirtualEnergy': tele.mVirtualEnergy,
            # LMU only, for the Damage widget: the 8 body zones' dents (0-2, in LMU's order), a detached part
            # (only the rear wing can come off), each wheel detached or flat, percent damaged, and the last
            # impact: when, and from where, in degrees clockwise from the nose (impact position is in the car's
            # frame: x to the left, z to the rear)
            'LmuDents': list(tele.mDentSeverity),
            'LmuDetached': bool(tele.mDetached),
            'LmuWheelsDetached': [bool(w.mDetached) for w in tele.mWheels],
            'LmuWheelsFlat': [w.mPressure <= 1 for w in tele.mWheels],    # as TinyPedal: LMU's mFlat isn't to be relied on
            'LmuDamage': data['CarIdxLmuDamage'][scor.mID],
            'LmuImpactTime': tele.mLastImpactET,
            'LmuImpactAngle': math.degrees(math.atan2(-tele.mLastImpactPos.x, -tele.mLastImpactPos.z)),
            # the Tyres widget reads iRacing's .ibt file, which Kapps' server serves as arrays of the samples since
            # the last update; LMU's are live, so each is the latest sample alone
            'ibt_LapDistPct': [data['CarIdxLapDistPct'][scor.mID]],
        })
        for corner, wheel in zip(('LF', 'RF', 'LR', 'RR'), tele.mWheels):
            # tread surface temperatures left/middle/right in Kelvin, pressure in kPa as iRacing's
            data.update({f'ibt_{corner}temp{side}': [wheel.mTemperature[i] - 273.15] for i, side in enumerate('LMR')})
            data[f'ibt_{corner}pressure'] = [wheel.mPressure]
        return data

    def class_positions(self, cars):
        """1-based position in class for each car, in the order of cars."""
        order = sorted(range(len(cars)), key=lambda i: (cars[i][0].mVehicleClass, cars[i][0].mPlace))
        positions, previous, n = [0] * len(cars), None, 0
        for i in order:
            klass = cars[i][0].mVehicleClass
            n = n + 1 if klass == previous else 1
            positions[i], previous = n, klass
        return positions

    @staticmethod
    def surface(scor, tele):
        if scor.mInGarageStall or scor.mPitState == 3:
            return IN_PIT_STALL
        if scor.mInPits:
            return APPROACHING_PITS
        if tele and sum(2 <= w.mSurfaceType <= 4 for w in tele.mWheels) >= 2:   # grass, dirt, gravel
            return OFF_TRACK
        return ON_TRACK

    @staticmethod
    def wetness(info):
        wet = info.mAvgPathWetness
        return 1 + sum(wet > step for step in WETNESS_STEPS)

    @staticmethod
    def session_flags(info, scor):
        flags = 0x4 if info.mGamePhase == 5 else 0          # green
        if info.mGamePhase == 6:
            flags |= 0x4000                                  # caution (full course yellow / safety car)
        if info.mGamePhase == 8:
            flags |= 0x1                                     # checkered
        if info.mGamePhase == 4:
            flags |= 0x20000000                              # start ready (LMU shares no start lights)
        if any(f == 1 for f in info.mSectorFlag):
            flags |= 0x8                                     # local yellow
        if scor is not None and scor.mFlag == 6:
            flags |= 0x20                                    # blue
        if scor is not None and scor.mFinishStatus == 3:
            flags |= 0x20000                                 # disqualified
        return flags

    @staticmethod
    def car_left_right(scor, tele, cars):
        """iRacing's spotter value (1 clear, 2 left, 3 right, 4 both, 5 two left, 6 two right) from the
        other cars' positions in the player's local frame."""
        left = right = 0
        ori = tele.mOri
        for s, _ in cars:
            if s.mID == scor.mID or s.mInPits:
                continue
            dx, dy, dz = s.mPos.x - tele.mPos.x, s.mPos.y - tele.mPos.y, s.mPos.z - tele.mPos.z
            # rows of mOri are the world->local axes: x lateral (positive left), z longitudinal
            lateral = ori[0].x * dx + ori[0].y * dy + ori[0].z * dz
            along = ori[2].x * dx + ori[2].y * dy + ori[2].z * dz
            if abs(along) < 5.5 and 1 < abs(lateral) < 6:
                if lateral > 0:
                    left += 1
                else:
                    right += 1
        if left and right:
            return 4
        if left:
            return 5 if left > 1 else 2
        if right:
            return 6 if right > 1 else 3
        return 1

    # --- session info --------------------------------------------------------------------------------

    def update_session_info(self):
        """Rebuild the YAML-style session info; a key's version only goes up when its content changes, so
        clients are sent it only then (like iRacing's session info update counter)."""
        info = self.memory.data.scoring.scoringInfo
        cars = self.cars()
        for scor, _ in cars:
            if scor.mBestLapTime > 0 and self.best_lap.get(scor.mID, (None, 0))[1] != scor.mBestLapTime:
                self.best_lap[scor.mID] = (scor.mTotalLaps, scor.mBestLapTime)
        values = {
            'WeekendInfo': self.weekend_info(info, cars),
            'DriverInfo': self.driver_info(info, cars),
            'SessionInfo': self.sessions(info, cars),
            'QualifyResultsInfo': self.qualify_results(info, cars),
        }
        for key, value in values.items():
            version, old = self.session_info.get(key, (0, None))
            if json.dumps(value, sort_keys=True) != json.dumps(old, sort_keys=True):
                self.session_info[key] = (version + 1, value)

    def weekend_info(self, info, cars):
        track = text(info.mTrackName)
        return {
            'TrackName': track, 'TrackDisplayName': track, 'TrackDisplayShortName': track, 'TrackConfigName': '',
            'TrackID': stable_id(track, 1000000), 'TrackLength': '%.2f km' % (info.mLapDist / 1000),
            'TrackType': 'road course', 'TrackPitSpeedLimit': '', 'NumCarClasses': len({s.mVehicleClass for s, _ in cars}),
            'NumCarTypes': len({t.mVehicleModel for _, t in cars if t}), 'TeamRacing': 0, 'HeatRacing': 0, 'Official': 0,
            'SeriesID': 0, 'SeasonID': 0, 'SessionID': 0, 'SubSessionID': 0, 'EventType': session_type(info.mSession),
            'SimMode': 'full', 'Category': 'Road',
            'WeekendOptions': {'NumJokerLaps': 0, 'IncidentLimit': 'unlimited', 'StandingStart': 0},
        }

    def driver_info(self, info, cars):
        player = self.player()
        drivers, est_lap_by_class = [], {}
        for s, _ in cars:
            if s.mEstimatedLapTime > 0:
                klass = s.mVehicleClass
                est_lap_by_class[klass] = min(est_lap_by_class.get(klass, 1e9), s.mEstimatedLapTime)
        if self.class_session != (info.mSession, text(info.mTrackName)):
            self.class_session, self.class_colours = (info.mSession, text(info.mTrackName)), {}
        for s, t in cars:
            klass = text(s.mVehicleClass)
            short, colour = ('PACE', 0xFFFFFF) if t and t.mVehicleClass == 8 else self.class_info(klass)
            name, model = text(s.mDriverName), text(t.mVehicleModel) if t else ''
            number = re.search(r'#(\d+)', text(s.mVehicleName))
            drivers.append({
                'CarIdx': s.mID, 'UserName': name, 'AbbrevName': abbrev(name), 'Initials': '',
                'TeamName': text(s.mPitGroup), 'UserID': s.mSteamID, 'CarNumber': number.group(1) if number else '',
                'CarNumberRaw': int(number.group(1)) if number else -1, 'CarScreenName': model,
                'CarScreenNameShort': model, 'CarPath': text(s.mVehFilename), 'CarID': stable_id(model, 1000000),
                'CarClassID': stable_id(klass, 100000), 'CarClassShortName': short, 'CarClassColor': colour,
                'CarClassEstLapTime': est_lap_by_class.get(s.mVehicleClass, s.mEstimatedLapTime),
                'CarIsPaceCar': 1 if t and t.mVehicleClass == 8 else 0, 'CarIsAI': 1 if s.mControl == 1 else 0,
                'IsSpectator': 0, 'IRating': 0, 'LicString': '', 'LicLevel': 0, 'LicColor': 0,
                # LMU only: whether the car's CarIdxLmuEnergy is virtual energy rather than fuel
                'LmuVe': self.uses_ve(s, t),
            })
        scor, tele = player
        return {
            'DriverCarIdx': scor.mID, 'DriverUserID': scor.mSteamID, 'PaceCarIdx': -1,
            'DriverCarEstLapTime': scor.mEstimatedLapTime, 'DriverPitTrkPct': scor.mPitLapDist / (info.mLapDist or 1),
            'DriverCarFuelMaxLtr': tele.mFuelCapacity if tele else 0, 'DriverCarMaxFuelPct': 1,
            'DriverCarFuelKgPerLtr': 0.75, 'DriverCarRedLine': tele.mEngineMaxRPM if tele else 0,
            'Drivers': drivers,
        }

    def class_info(self, name):
        """A class's short name and colour, kept for the session, as Standings regroups a class whose colour
        changes. A class this doesn't know takes a palette colour no class has had this session, those of the
        classes least likely to be there first; past six classes, colours (and so Standings' groups) are shared."""
        if name not in self.class_colours:
            taken = {colour for _, colour in self.class_colours.values()}
            spare = [colour for colour in reversed(PALETTE) if colour not in taken]
            self.class_colours[name] = CLASSES.get(name) or (name.upper()[:6], spare[0] if spare else 0xFFFFFF)
        return self.class_colours[name]

    @staticmethod
    def damage(tele):
        """Percent damaged: dents (8 zones, 0-2 each), a detached part (in LMU only the rear wing counts
        half) and any detached wheel, as in TinyPedal's integrity reading."""
        integrity = 1 - sum(tele.mDentSeverity) / 16 - tele.mDetached / 2 - any(w.mDetached for w in tele.mWheels)
        return round((1 - max(integrity, 0)) * 100)

    def uses_ve(self, scor, tele):
        """Whether a car runs on virtual energy: once it has reported some, so one that runs out still does."""
        if tele is not None and tele.mVirtualEnergy > 0:
            self.ve_cars.add((scor.mID, scor.mVehicleName))
        return (scor.mID, scor.mVehicleName) in self.ve_cars

    def energy(self, scor, tele):
        """Percent of virtual energy left for cars that use it, otherwise of fuel."""
        if self.uses_ve(scor, tele):
            return round(tele.mVirtualEnergy * 100) if tele is not None else -1
        return round(scor.mFuelFraction / 255 * 100)

    def sessions(self, info, cars):
        ordered = sorted(cars, key=lambda c: c[0].mPlace)
        class_pos = dict(zip((s.mID for s, _ in cars), self.class_positions(cars)))
        results = [{
            'Position': s.mPlace, 'ClassPosition': class_pos[s.mID] - 1, 'CarIdx': s.mID, 'Lap': s.mTotalLaps,
            'Time': s.mTimeBehindLeader, 'FastestLap': self.best_lap.get(s.mID, (0, 0))[0],
            'FastestTime': s.mBestLapTime if s.mBestLapTime > 0 else -1,
            'LastTime': s.mLastLapTime if s.mLastLapTime > 0 else -1, 'LapsLed': 0, 'LapsComplete': s.mTotalLaps,
            'JokerLapsComplete': 0, 'LapsDriven': s.mTotalLaps, 'Incidents': 0, 'ReasonOutId': 0, 'ReasonOutStr': 'Running',
        } for s, _ in ordered if s.mPlace > 0]
        fastest = min((r for r in results if r['FastestTime'] > 0), key=lambda r: r['FastestTime'], default=None)
        timed = info.mMaxLaps > 999999
        return {'Sessions': [{
            'SessionNum': 0, 'SessionType': session_type(info.mSession), 'SessionName': session_type(info.mSession).upper(),
            'SessionSubType': None, 'SessionLaps': 'unlimited' if timed else str(info.mMaxLaps),
            'SessionTime': '%.4f sec' % info.mEndET if info.mEndET > 0 else 'unlimited',
            'ResultsPositions': results, 'QualifyPositions': None, 'ResultsOfficial': 0,
            'ResultsLapsComplete': max((r['LapsComplete'] for r in results), default=0), 'ResultsAverageLapTime': -1,
            'ResultsFastestLap': [{'CarIdx': fastest['CarIdx'], 'FastestLap': fastest['FastestLap'],
                                   'FastestTime': fastest['FastestTime']}] if fastest else [],
        }]}

    def qualify_results(self, info, cars):
        qualified = sorted((s for s, _ in cars if s.mQualification > 0), key=lambda s: s.mQualification)
        class_count = {}
        results = []
        for s in qualified:
            class_count[s.mVehicleClass] = class_count.get(s.mVehicleClass, -1) + 1
            results.append({'Position': s.mQualification - 1, 'ClassPosition': class_count[s.mVehicleClass],
                            'CarIdx': s.mID, 'FastestLap': 0, 'FastestTime': -1})
        return {'Results': results if info.mSession >= 10 else []}


class Client:
    def __init__(self, ws):
        self.ws = ws
        self.fps = 1
        self.params = []
        self.params_once = []
        self.sent_versions = {}
        self.next_tick = 0


class Bridge:
    def __init__(self):
        self.lmu = Lmu()
        self.clients = []

    def find(self, ws):
        return next((c for c in self.clients if c.ws is ws), None)

    def check(self):
        connected = self.lmu.poll()
        if connected != self.lmu.connected:
            self.lmu.connected = connected
            logging.info('LMU %s', 'connected' if connected else 'disconnected')
            for client in self.clients:
                client.sent_versions = {}
                self.send(client, {'connected': True} if connected else {'disconnected': True})
        if connected:
            self.lmu.update_session_info()

    def update(self):
        if not self.lmu.connected:
            return
        self.lmu.update()
        telemetry = None
        for client in self.clients:
            if self.lmu.tick < client.next_tick or not (client.params or client.params_once):
                continue
            client.next_tick = self.lmu.tick + max(1, round(60 / client.fps))
            if telemetry is None:
                telemetry = self.lmu.telemetry()
            data = {}
            for p in set(client.params + client.params_once):
                if p in self.lmu.session_info:
                    version, value = self.lmu.session_info[p]
                    if client.sent_versions.get(p) != version:
                        client.sent_versions[p] = version
                        data[p] = value
                elif p in telemetry:
                    data[p] = telemetry[p]
                else:
                    continue
                if p in client.params_once:
                    client.params_once.remove(p)
            if data:
                self.send(client, {'data': data})

    def send(self, client, message):
        try:
            client.ws.write_message(json.dumps(message))
        except websocket.WebSocketClosedError:
            pass

    def on_message(self, ws, message):
        client = self.find(ws)
        if not client:
            return
        if 'fps' in message:
            client.fps = max(1, min(int(message['fps']), 60))
        if 'requestParams' in message:
            client.params = list(message['requestParams'] or [])
        if 'requestParamsOnce' in message:
            client.params_once = list(message['requestParamsOnce'] or [])
        if 'broadcast' in message:
            for other in self.clients:
                self.send(other, message)


bridge = Bridge()


class WebSocket(websocket.WebSocketHandler):
    def open(self):
        self.set_nodelay(True)
        bridge.clients.append(Client(self))

    def on_message(self, message):
        bridge.on_message(self, json.loads(message))

    def on_close(self):
        client = bridge.find(self)
        if client:
            bridge.clients.remove(client)

    def check_origin(self, origin):
        return True


def run(name=None):  # called by Kapps' cx_Freeze launcher with the exe name
    parser = argparse.ArgumentParser('lmu')
    parser.add_argument('-p', '--port', type=int, default=8187, help='port number (default=8187)')
    parser.add_argument('--no-update', action='store_true', help='accepted for compatibility with Kapps\' launcher')
    args = parser.parse_args()
    logging.basicConfig(format='{asctime} {levelname:>8}: {message}', datefmt='%Y-%m-%d %H:%M:%S', style='{', level=logging.INFO,
                        handlers=[logging.handlers.RotatingFileHandler('lmu.log', maxBytes=1048576, backupCount=1, encoding='utf-8'),
                                  logging.StreamHandler()])
    logging.info('Le Mans Ultimate bridge on port %d', args.port)
    web.Application([('/ws', WebSocket)]).listen(args.port)
    ioloop.PeriodicCallback(bridge.check, 2000).start()
    ioloop.PeriodicCallback(bridge.update, TICK_MS).start()
    ioloop.IOLoop.current().start()
`;

// lmu.exe and its script go next to Kapps' own helper apps in app.asar.unpacked, outside app.asar.
function installLmuBridge(asarPath) {
  const dir = path.join(path.dirname(asarPath), 'app.asar.unpacked', 'iRacingBrowserApps');
  if (!fs.existsSync(path.join(dir, 'server.exe'))) throw new Error(`Expected Kapps' server.exe in ${dir} — aborting without changing anything.`);
  // the launcher is the same for every patch version, and a running lmu.exe can't be overwritten
  const launcher = fs.readFileSync(path.join(dir, 'server.exe'));
  if (!fs.existsSync(path.join(dir, 'lmu.exe')) || !fs.readFileSync(path.join(dir, 'lmu.exe')).equals(launcher)) {
    fs.writeFileSync(path.join(dir, 'lmu.exe'), launcher);
  }
  fs.writeFileSync(path.join(dir, 'lib', 'lmu__init__.py'), LMU_BRIDGE_PY);
}

// --- Standings column titles --------------------------------------------------------------
// An optional row naming the driver columns at the top of each class, under its header (General > Column
// Titles; iRacing and LMU). Each is a copy of the driver row template with its cells' contents hidden and a
// title laid over each, so the titles take exactly the widths of the columns below; a column is made at least
// as wide as its title, and the last column, whose width each driver row sets for itself, takes the widest of
// them for its title. A class's first driver moves down a row
// to make room, and Standings' height, calculated separately by index.js, racing-overlay.js and settings.js,
// grows by a row per class.
const STANDINGS_COLUMN_TITLES = {
  position: 'P', gain: '+/-', 'car-number': '#', name: 'Driver', ratings: 'Rating', gap: 'Gap', int: 'Int',
  'lap-time': 'Lap', 'fastest-lap': 'Best', 'tyre-compound': 'Tyre', pit: 'Pit', 'gain-history': 'Gains',
  ...Object.fromEntries(LMU_COLUMNS.map((c) => [c.className, c.chip])),
};

function patchStandingsJsColumnTitles(src) {
  // the template is made once from the driver row's (pruned to the chosen columns by init()); reset() empties
  // the rows, titles included
  src = mustReplace(
    src,
    'this.rows.innerHTML=""}',
    'this.rows.innerHTML="",this.titleRows=new Map,this.titleWidths=null,this.titlesTemplate||(this.titlesTemplate=function(t){' +
      'return t.classList.add("column-titles","row-odd"),t.querySelectorAll(":scope > .wrap > div").forEach(function(e){' +
      'var a=document.createElement("div");a.className="column-title serif",a.textContent=' + JSON.stringify(STANDINGS_COLUMN_TITLES) +
      '[e.classList[0]]||"",e.appendChild(a)}),t}(this.driverTemplate.cloneNode(!0)))}',
    'standings.js column titles template'
  );
  // layout: a class's first driver (no driver before it, or one of another class) goes a row further down
  src = mustReplace(
    src,
    ',k=W,I=U,_=q;',
    ',W.firstOfClass=n.settings.columnTitles&&q&&(!_||q.data.classIndex!==_.data.classIndex)&&(W.y+=n.rowHeight+n.gap,!0),k=W,I=U,_=q;',
    'standings.js rows below column titles'
  );
  // ...and once the rows have been aligned and set moving (after delay a), its class's titles move with them to
  // the row above it; the style is rewritten each time, as the last column (and so which widths it sets) changes
  src = mustReplace(
    src,
    'X.style.translateY=W.y));for(t in a=0,',
    'X.style.translateY=W.y));n.settings.columnTitles&&(Q.titleRows.forEach(function(t){t.classList.add("hidden")}),Q.standings.forEach(function(t){var e,c;' +
      't.firstOfClass&&((e=Q.titleRows.get(c=t.driver.data.classIndex))||(Q.titleRows.set(c,e=Q.titlesTemplate.cloneNode(!0)),' +
      '(c=t.driver.row.className.match(/class-index-[0-9]+/))&&e.classList.add(c[0]),Q.rows.appendChild(e),' +
      'Q.titleWidths||(Q.titleWidths={},e.querySelectorAll(".column-title").forEach(function(c){Q.titleWidths[c.parentNode.classList[0]]=Math.ceil(c.offsetWidth)}))),' +
      'e.classList.remove("hidden"),e.style.cssText="transform:translateY("+(t.y-n.rowHeight-n.gap)+"px);transition-delay:"+(Q.animate?a:0)+"ms",' +
      'K.lastColumnNames&&K.lastColumnNames.forEach(function(c){K[c]&&e.style.setProperty(K[c].cssName,K[c].width+"px")}))}));for(t in a=0,',
    'standings.js column titles placement'
  );
  // the titles' widths (measured when the first titles row is made) are the columns' minimums
  return mustReplace(
    src,
    '"name"!==s&&(lt.width=lt.items.reduce(',
    '"name"!==s&&(Q.titleWidths&&Q.titleWidths[s]&&lt.items.forEach(function(t){t.width=Math.max(t.width,Q.titleWidths[s])}),lt.width=lt.items.reduce(',
    'standings.js columns fit their titles'
  );
}

function patchStandingsCssColumnTitles(src) {
  // the cells keep their (hidden) contents for their widths, and the position cell its class colour background
  const rule = '.rows > .row.column-titles > .wrap > div{background-color:var(--bg-hsla)!important}' +
    '.rows > .row.column-titles > .wrap > div:not(.position) > :not(.column-title),.rows > .row.column-titles > .wrap > div.position > :not(.column-title):not(.bg){opacity:0!important}' +
    '.rows > .row.column-titles .column-title{position:absolute;top:0;left:50%;height:100%;transform:translateX(-50%);display:flex;align-items:center;white-space:nowrap;padding:0 var(--padding);font-size:calc(var(--fontSizeSerif) * .8);text-transform:uppercase;color:#fff;opacity:.7}' +
    '.rows > .row.column-titles > .wrap > div.name > .column-title{left:0;transform:none}' +
    '.rows.animate > .row.column-titles{transition:transform var(--transition-duration) ease-in-out}';
  if (src.includes(rule)) throw new Error('standings.css already contains the column titles rule — patch already applied?');
  return src + rule;
}

function patchStandingsSettingsHtmlColumnTitles(src) {
  const showHeaders = '<input type="checkbox" data-bind="showHeaders">\r\n\t\t\t\t\t\t</div>\r\n\t\t\t\t\t</fieldset>\r\n';
  return mustReplace(
    src,
    showHeaders,
    showHeaders + '\t\t\t\t\t<fieldset class="column-1">\r\n\t\t\t\t\t\t<label>Column Titles</label>\r\n\t\t\t\t\t\t<div>\r\n\t\t\t\t\t\t\t<input type="checkbox" data-bind="columnTitles">\r\n\t\t\t\t\t\t</div>\r\n\t\t\t\t\t</fieldset>\r\n',
    'standings settings.html column titles'
  );
}

// --- Full-colour car logos ----------------------------------------------------------------
// Kapps draws car makes' logos (in Standings, Standings (Legacy) and Relatives) as single-colour glyphs of its
// icon font: an element with the class kapps-icons-manufacture-<make>, whose :before is the glyph. Racing
// Overlay > System > Car Logos > Full colour (settingsMain.colourLogos) adds colourLogos=1 to every widget's URL,
// and on those pages the glyphs give way to full-colour logos, each on a light tile so that dark ones (Toyota,
// Mercedes...) still show on the dark rows. BRAND_LOGOS are small WebP images made from the logos of
// github.com/filippofilip95/car-logos-dataset and Wikimedia Commons (Dallara, Oreca, Isotta Fraschini; public
// domain), or plain wordmarks where neither has one (Glickenhaus, Vanwall, Duqueine). Oreca's is its star alone.
//
// A car's make comes from matching its name against a table of which each of those bundles (and Standings'
// worker) has a copy. The makes of Le Mans Ultimate's cars that Kapps doesn't know are added to it, as is the
// Corvette, which it only matched as the C7. Those makes have no glyph, so with colour off their logo's shape
// shows instead, in the colour Kapps' glyphs would be.
const LMU_MAKES = { alpine: 'alpine', duqueine: 'duqueine', genesis: 'genesis', ginetta: 'ginetta', glickenhaus: 'glickenhaus|\\bscg\\b', isotta: 'isotta', lexus: 'lexus', oreca: 'oreca', peugeot: 'peugeot', vanwall: 'vanwall' };

const BRAND_LOGOS = {
  acura: 'data:image/webp;base64,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',
  alpine: 'data:image/webp;base64,UklGRpQFAABXRUJQVlA4WAoAAAAQAAAARwAAJgAAQUxQSFoCAAANoHZtmyFJVn9Htsa2bdu2bdu2bdu2bRtr27ZVWxUf8q3IzI6ImADsndkD9581/8TqDNNDiNexO8UOjahP2VVhNVH/ftsmVXMO0T8IWxQzqCGGy7E3YUZaDL+5b0+GzSFMb2FtwQWY37am9HLEiCOEbXE6D8StTxUrKtxVlowuj1sv+3U3br0KKxPWaty/L0jaPSx89rkVWQ8g/jkRNQjxlRgbKs7WwmdDHPJnl44RcIG0z73F1BiDW783BeiM+NvDYJxWLavjfUgzxCezgIRa0nECzTYhz1w8px6TErc+sQ8gU0YhdCaQUls1RzzFbtWIm5/g7qCFH74JIPn4+rDP8VJkC2Jo1h+44/sjPonxL+8R4KfZmKtSmxF/G4JcHlFvx++Ewe0Azisz1a0n4mcTnSgNpQ8+8UllnRMBiBzEOG5EWcT3xxG9iXQZnxtNQ7wSa5Ryw7+ItxYRPU9aQd/0J83UEoihS+VjDZwRGvGro+VzRWuIRHmzf4Ry2yLIscvLYag1coYNWYkelpxDWY3+HQ+kHNCM6CqpMjGMj8PH5Jh+MtuBdIex/teuENdjKNZfmAQMiXvlQz8yZFfSl997yZBD0G+FDJ5dAdi0W+NjxeUpcOvrc//1oJbXET7qrA0U7jA+xjQYgRg5dgSv6YoibidRjq2OGF76EZ7z/yP8fiMxpJ3xH+JvS+Lx3hbx3RSJwNmLHO6t8J68u3RfBVdiG/L7Ixx8bIz4/2GCVpWWIuqvhuKnais9V0E5/Voi356GrwklBH2QoNtkf+1b4bUT+Jvzvfdd//7jC1ZQOCAUAwAAEBIAnQEqSAAnAD4xEohCoiEhGZquACADBLY2NOYAP1jt7AvQPxV/ID5O6Y/JPub+32Xl8G/17+S/jrwAH6Af6jdAfar7x3SAf1L/Kekd7AHoAfoB6N37J/Ab+137Pezp//84YL53ml74B+tzmf1R0riuVwBfsmpDDElg3LMA/XzSHehsylKBeXlVbGVTWAYr4zTDIIYV1RqAAP7/j7wX3/cZ5/iL59835eyZpzk/1e8+lL+IDHEyPfeymbP//i9//PMWJXpBP4eIlrI7wmoOsUiC3iv9HSjDbtyQbEeVgLU2s+E6ipa929z7gU7JZ+d/v7feb42+pVH5N+UBc55z1/Z9t10knSGEVGRi3FqdhqHT1x4nR0Glijr3FRnSo2neGK4Y2rP4RCLtNLv/Hsr+Q4///xVYXk0eM6n+PwvRST4GY23M+k+eT3V/C0zNWLszOGMdP+cMv8hIzOJMwTQhtjQrsdvj3NXkwBKiapJtWKsPNM8wr+ohooJwAd3q39zLzueXe7NtV+ihXCPhIPAWguQz1nMqiDLjVFJPI30afZQDj8GnRtGtQqQtKA1kVLo5uopG+g4onqqE6YvOrRGx+38CbjU8IE/uCIpeeHvqmikRL8aMTxCUAhe6wL6LxdjLEk/8e5hD/5C15wqhwy1oX3NlLyxv6/Aw6PMVNeV1owd2PmapGUov51wOzfDpwZDXL1hE1ZrRdtg7VDbX/kYLuZzlDxaBAK2bQWnS1VEXuSPXH5DhLMexjdgwBdgl/9kWMqrmgi4esJVnHZuOcP/g392/+mRVHwPvlk6t4DwrLnd8algpKTwaYEskCncjBV09gBeZthaX0+srrl4sAQz1NKZ22hgy7ld5HbbLM4QzNPEMwr8HlDE1Xl/4BiviFFg5hgpWDe+wqjqKMh/+hzW+TUAt3yaX2o/DFwkiH7sauH3GImW0whm//+vx1AbL//9vWj864Mv++Bh/IISUteCMY4rZZwonv/6hFclZPoiLbfmO0YN+w2oWYZkGnbj1/IF5P7nAMZmlr8IRLBf8vr9IAAAAAAA=',
  aston: 'data:image/webp;base64,UklGRpIEAABXRUJQVlA4WAoAAAAQAAAARwAADwAAQUxQSIMBAAAFkLNt2/m3A7ru2MaY2raNLdlqu13dfgKPtrUlW23b1mi7//zv4f/7K42ICVhbTZwWMf+sXfmeyLJFNTnEbBFnXdOR8WDFBFtn1wOpG6cTu0W8h5dta5kVR9yfzvwFMgYUx2AR/+/H026Urh0di4UBxZLI+lSD4jg07wM02ds238ICC7CcpLBkARZYWN/uj38BUDB3OZFWAMYpSalPQQRYRC5Z/5XAzLr+2VgAloWJUY4QlhWDsCwAi19nq/8QNbeqZnJLLIItMMIyyCIywAgsgi0e76x9/YOYU1oP69euWRpYYFlgkUjLAgtCz+6dO/YwTALTcssnz6gUsVtYWFhBUf1my853P0IkXp2GVA+IZkUEW1jRztSduGWS3vx+epBlEatlBf1r+5QGOXh+/3yBBZbRXzKMLLDA386uOUkDTcscMWNYWgpYwO8ZbMkCLAiHjm058idEQy7u2r1r50Yp8GX+TiavKYTwq5vXr17/xH8oNZs+OTTqAtDnUNrOrc9skggAVlA4IOgCAACwDwCdASpIABAAPjESh0KiIQzKABABgllAMhjef/YOgl8Few2T6fM+IHSk+RX+xfkl+KvqAbBr81/t345/jprzvGDdc+oj/PvLvzd/JP+l9wL+K/yT/Ifl3/kP//9KvUTfo2xHduizvYEGXRU8eVj4o/cYHapZM8Uh08TTitrbsGJJw/9oAAD+6l/3+6cF7/6jkCGwZlEyf/2vH8QFGNeHXy8c8GOmi1A0h6SnCi5OOCVpfQm2s3LVlrjKd8xT0nmspz5v0l/Wt03Gt/e5uU5/3RTdv+W87oNH/qjBQ2aln/2YWd2qxhjgJqoaNhwn/bSiLOtnz0/YTNp8n9Pbe3ftyZXjLIZa6UZK30djr46DSYEpjmeMkWs8ffvc8RmvTE2DIb3KFC9tCQOfroisLFzzTd6Tzwyg3QJTfjbMGuUbCrM+isszTSPS7HaO6/kLyU701sIlNhvL5QoXLuyBNnbx8OBskcdDc1tOdw3aqghcNStl4XXspKNpGTCoJSWIKTHsYShOFWdO37mdn/wRUWtWhl1RR69rpu0mnMpBc3CTYgYp/+MeI3i///PjjucZnXpBu3+rg3hUI1B0xW0qHvmD29psqZukRPphe22/QEuWb/yUqS+D4q4o3ez6hSUMX5PK3HR9RPhrPMJw5Zy4G082La1NZn8E3r+EFkN2i59mEb7Dq/MM85c83J9ii0yh/xxXqCV3tlLhaaQ177zu2TndSOoT9z8PMRPQVSeyyjwAqKfHnwEITLa/+JKqLdpdtdQ3j7bgMwtTcXMa31Mqt+q1Uu/UjVPepFzGXIeo1J4HQp5mUYIRuOca1glboN2sfiv/+r9PZyF3gSettcdIJltx2UyAoV6RKvMAOF3hnMu3/hYjuv9a2EzN+Q5lNewrlNIRugAYhghVbHQYG3jnGmVSpaeqcHNbM+oMLCFEP/33E4SX/0AIE7g36FvvOisaPUmolc3DnRkgDn6N7oKu0rtqcMOM/PsAAAA=',
  audi: 'data:image/webp;base64,UklGRnAEAABXRUJQVlA4WAoAAAAQAAAARwAAGQAAQUxQSB8EAAABkLZt29nIE7rTjmfa0dq2bdu2bdu2bdu2bWNs7eDwFJMm94dgI2ICoFlizbuQiIiQNytKCADgMeJeYHhE2I+TTY0AYGxy7EdYRHjgvREeACAUWvYmJCIi5N2aEtBvbHjeSs2cc42EwivjqSl/GOTpOei9TM34lYWFhmdt1LSeb2jU4bRQJmV7ckREsl0mxc2JpCxmRIXHZjtIPn9OUrLEhUdliDL5b6NIyvbkiIhku0zKC4wazudkSq/6lvNycjKV6//CQZIJC+r4OxvdCrbYn0WSliNtCrsZnf1qzY4lSendwPImJyevcn1fSpTOOat4XCD/jRGgaThLMswf2j0U/aHtH0byrBGawph/5AUPxSQyspgA7bzJJB1TtAyPFE+NWlMcJFOKaEEoFk1OAlAumYkNoNPzPcU1CbRWVhPmyHzwmPJ8Qa2alfFrRH42aQH1E5lSDoZz5Ejo7UI+FObJ3KlmDqetYiUbw81qOynPEx6SvfVgJHnOYIphoo+uM3Q0gecvJppVuji42WDYQqm7ik8if3miiYPXdPkkMsbUXJInQK9XEp8DGCezv8LwjKk+gE8qnxsUYymPA/Ccab56MEGWmu9kpouueuR4AJVsPKHwy+ELAHhF0Q+AcIm2SgDGk211uWRy52cGQfcESs0A5M3gSycAFchjimNkBQDO75mRF0ALiXN1IYgfY/hZ33KKdQCYUvnFBUB9cqtiG1kfgPtvppoA1BG5Rd9nxkT+zxIdnzS26fvFNLPa5v+JfMUQfWMotQaQN4PPjADKkScUp8iyAJzfMiMfgNYSZ+oL4avttJh11SHnAKhm5zEAMGXzreIts00AhPO0Vwcwh2yqy2zh9nqivEiXRxw/OgGTZLmbQnjIzDxAnkzeFACgP+WpgNNHJnrpWiSLdTzDmJZHDw5Q6gCfMEa5K9DKwSNG43GKLaH0+sdwH3SQeBR686QxzFPYR87W1ZJ8L6wjV0HVK5g5tWvnMNBTBRvJtcJ7soWueeQ+AYWjmNlRj+sdSsdSmV5aTRgv8csXSiOgXjaTqUcl3nHV0ymTUYUBDJaZVMOgBd9okjk9oClcJMlzggb655CM9oW2oUYS5cEA4LpBYtYaNy3XuySjS2thnGIctMvEkLzjquW2JovSBlcFhO12MmhGvULe5kINZoXKJGnZ27akrylPpT6PHArHo4GV8ph8S7bdayFJOXR6vYJm70L1pgaR9u0C1A39RZKiJTXV4pDJzAF/SUr29JTsHJnk0aMk5ZzslHS7RPLPkGxSFi2pqRaRpNjfAG2h3MYEaiZtLA+/sV8lqlsvt3Fx6XDdRnXp6xg/VNyaQs2EjeUE6DcPuvA9IOD7hSFeUAqN974PCPjzYGFRqJZc8uBPQMD7vY0FKE0DL3wPCPh+YZAZmgBWUDggKgAAABADAJ0BKkgAGgA+MRiLRCIhoRGkACADBLSAAAx+cuLyQAD+/nyUAAAAAA==',
  bmw: 'data:image/webp;base64,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',
  buick: 'data:image/webp;base64,UklGRswFAABXRUJQVlA4WAoAAAAQAAAARwAAFgAAQUxQSOYCAAABoHVr2xlJ39CVZGzbtm3btm3bOLTx2bZtG2PPtLtT1e7C+7wHeWuUiJgAzDU2ffL3fz+fHVgAX1vdXsmSwJXzt3PVpdVlfGRvVeHfhxcGqu1IU5fr+qbIs6Hz/QvifftuMCp3OvnE2hT9vDSUrVixYsVfRZSS7Bb+6BeKrwD86LquGxattcinvsj3sdvKcRznvJi1lqToHI9Vs07lfIZq5TxO7ZJQqE4hQ4E2Y4Y1sKFwnUKAU6tK5az3L8fFxcVFPUq0aNl98f8iQMG7kdybM2zg7+OeqpnLoWteN8Dp8ldWihs5AL1DXSDf0sylW9T4gHi1aBERLbLjULCu4ZV2S93Z9xXyLM98skXNekOPQK9wF9iQPs35NbNiukG0iIgWkcXjokMMJ+GJv5wHMSh7iwNQwJBvUfJym8BvJTK01qJEdIx+7dTqWAf/fSDv/VmImL3CXWZF5gE5nxUNihatxKi1ZFdpIjsMj5UdeGUUDyJ+NffyTPLsfEDSz0WCSrzaI1quFe4kawxZKbn/tbMfQJFwn3tReQlNAL4JlAhqg2jT+/bM6HDDMzWbHg+2fwB21oR7iSz4Mb4msFANjRMdI+UHkegIzqXXN5yE/L88DX8866mdtdjE76/nu4dQl6bJHxSFkoEXvxatRUSJfF0/Qz60Ct0+XzSW9dYP8P7vBYDuoZExdgRbGSzoFe5C58wX8uO8lXbak/27KDWKFYFG9mNqCSbLGp29HRZkT4JiH6SUj1Hyi9vjgFLzTKzJWw3tgkqJlg/75srHFk4NRoe+cUxp5+MCb1WAgk9nf/PKrRvdiEHZFwO/PfNOxvPQK9QFnMfzRsFcpURCTdgebg7QJ1e1w2sPHz++X1kbwG5z8u2VxQHKjSsPYFfb9vqTIwpC+bFlgcLDB0ChXSGR16BIY6Dcfjd5IL5dmao+7V2nYrmqzdfdUZd64V+r/guhiBt3OylHUteXw9+Nlj323sdvHJlcAd8CVlA4IMACAAAQDQCdASpIABcAPjEWiUOiISETPAWAIAMEsYBjvLgHSe/uB6QFIAe0v8Bxg0Sf+x9NnNU7ke4H+pP+f66H7Tex3+wANqFEufzhHTg2OkiLcm2wCFvKoAyUF+CpcNHyLxqsusyuS6P/CKHoMLe8+DIMgAD+7/Ut8tcyfujmLz248mxLF1BKYENDWqv/QUJJ+zSoZhtw/SvwYT0a4jFgB/TP+Et9zwBahr01Oy7OcwMnfyIUwNXmeHKR8mIfU02jb3f3Rf4v/asPoGOM4CCF/31RUfYo1ufePzp015iNVY6NhKiPyJ1Qw6uSX/Tl+8w4ALuWGT0/XeSczZxSu9cZTJVpVa6p/XRNHckmk4rnIDMb105A313N4WX7RP8YjLZTnaqPFvxpymLHqJFoVWP/6+Vt6ton8/hVipDLtDk3qP3jVGkf7RaX+3AdV9Hi1CvwlhJU3+7aBNuMlgNfP/M0S0nUXdfHHmUjuh/2/o/T57gG7Ad0l0NSyM4tE7/Gfns2fOr9lbi9QqBPAIm/KefozplOnin57PvJMzwnvoiDXrSfe0xGPLCBvZGGdLW7cVnrWYQB0hwOIq3egrNs2J8yO4aLPrAOIdlolIjR0rkoSjllqvsO6Ow/lC9osc+u5rKiQowuYXGmob/OueG1mhnFiDpY5SlSiMzjFjkRG55bB70VQ1INIMUznA1oFpbIo7e5b7LeOGxewH33/BFbs0tYl5hXTiHOHUn9H8cyXDOaIY8wKz6j8/QhF/8+kfcW3rV6otsPmRg5zFQXz7Q9Pgj/sYKt6UMV0y07ij7T+Dec3hzRjGMFEF/PcyTEiPQeoiTrfpZvtq1BMTndoY0I8vIuiDE/C5RlE5ekwAs1zwhE4WNQZau1NPPugG0I8NaXIOgWWzGmWI1g1gAgAf0xJ21EEoHuzZKBb/6Tqia6XtM6wUIAAA==',
  cadillac: 'data:image/webp;base64,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',
  caterham: 'data:image/webp;base64,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',
  chevrolet: 'data:image/webp;base64,UklGRlAEAABXRUJQVlA4WAoAAAAQAAAARwAAEwAAQUxQSIABAAANoKNtmyIre96qGtwjd/fQWQARGbnF7qRcpA4Zq2ABLMAyi9zd5ZeqeoPuq8/IBiJiAuj38RW93rg0KaTxMYr8X871b8mlXLnHcPcO4q6kcSmFiTGl+O3mkE2aDGLshtnvBjOjl5ISiV6KIaYYx9Nns2lVziW71FxzJv9DphbgZ2P5rQm2jXFHZPUBNh9NKSbFkEJKpAkkQgSeN/Ya2SAxYNFHI8D1BrBkN0BgVA3o9W3QaUbYAYzqmQAzdgIOI9IUvvMGdA6wGE0HWm8A67ZjMSIWrY8eAAdsgdXBDRn1wxqD3PLvecH8XQbEWIVMP2VQF9Tw4xfAFRtMU24RYESfLXdqvx6AGe9CiywLgwKgWfT77zshu2GwsJ6/B9jzUwohih4RQkg4hDD5Qiergx5d/acUqmtVrbatMFmNz2+LKgUyBexs11qn7HDo0NX6e99RREKoURJyFk0XKsbGAKZ1igP9tf4pDLXoaGRQiyiB4X5xdrYrrjUXWpWCmgvG9w1WUDggqgIAAPAMAJ0BKkgAFAA+MRKIQqIhIRmdVQAgAwSgDGsAKgd8UD9bvfm9AG8Abzw3/6MEAp4C/0WbR+Uj6X9GL/U9bP0GBctVia8hFOUOsItI2swUqhXk9ReTzKKlfP5HPqUW68wvwIDx/2iUM9cfnIY1rAAA/u1gBm6qO7xseytWZE4/7NJtP5qjb46u6WmlUScLfRtbWtJqRH5/MQsOoodGl9zw2UrwzKgjJRtIXla9Z//9R1hfqt8ZHSFAb0bcwe//SdPNkWbPhsBnfOB/1xXc+bj+SSyCYMnRIQ+BE1Vl9X5BgJxNrk6sYLECb190mAiYCNlC3eP8Ft5OKkQLSCUiuEuIj5MkWJsOw9f0gJ6jtDpfMgtdi29IzRnHf8sPP8wiYX9f+nsU1QKpna875jXE+dHTF1lWt76LxE14sCh9+VbxN8rD5/hqUZAwNeh6fQHrxd1Tw3LioSGgJ/4Jva5nhnkCPUd9U3xwYrr59gDhnXzMmpTyM5R/j/midaUtZHv+09H/TDTOAfjHpboR+42Rpb/r3l1n5VF/uiAW17ShBY12wIpekW+8spZhb7iJL8HVOZFnw7AHoUXl6Dsb/60Zzynkf06yDJ9bbQevJ7sBsjvm5v9oQvzXn+7yOouFAtDYsmm9b3xfv+m39fvC+P+856GG6N/d88f/5ZVHHYI49fuTXX+H8P/A0vPUrgeGYqdr0EU+tc0pNtdfB/vdXVPQvZqW/+MpJoTQ0wMpx7pcf4bdK8jS7jUd4gNmK/A/+BRqX0FXn/kDL3gu21ydVNB7KnrmpiaR/c4//xJ7zhgUkHGNu8bf91VbtEjWXXTU5y0u3ELwpJAK8hQCkNQvE03q0cJM5uKqcOdplT17mnBX29U0aWCE42/XzNE8ax4RbYzPdPsdZ9QJkUAAAAA=',
  dallara: 'data:image/webp;base64,UklGRoQDAABXRUJQVlA4WAoAAAAQAAAARwAADAAAQUxQSNsBAAANkCvbtmlbfeMeXPvZtm3btm3btm3bjIzUtq9trmCvdZ5+ICImABcdkR5bx+F6sTdZjc/m2DyBfz/vj98At+Awyrz8D/77IDsQmgkEOCVpUdku+btLREi2IsgOhPg6JdkhQpLzWjkhLNWBesckdt/HdbJcaHhYouV43/Yz0He3EMD3tZskevDTpnFQ4CLy8r5JcL+OYcGosq12uupyiZIW9BILu0PgcqTVL7j7WTAqzm8PY+HUDQFoDRwQ1aSQDXD0alk+85Uqs4PNBri1714170UKw6VDAig6MIcNcPRtVjvmNV359eijhyW/AC3foLwaRDWe4FywQEW+niWApBJDCi5ZkK3BNqTNBuTRIL7inMCdw7Nz8Gg3LpZdhdWj2vYh7V+/V+Q5hNU2YVOHotHRBsqqi7HaGu/qUfVH6IeiXYtM91cYTSBFAP1aDqPDJUUXSBFAj0GdnAtn2lQtIEUAs5t2s3U6tWcYj+6HIxIswVXgeTIQeBWmrFOYiMcZADcSPQZfD1WZiKdpgHY501y24kCR+jmKm2helpDNNanugTxnk2Oymy302jYLoDW6pbpfT6vpQO6sk9i99sDcOvKQkANzgzUFAw/KXq1YkcPQZcxZobp9ZlGgpmAkAFZQOCCCAQAAcAwAnQEqSAANAD4xFolDoiEhEzUAIAMEtgBOmXZ8J85/En9mauj5YvrnmA5gD+jboD+Afw//Af4D2Of0z66rzgOsA/UD0dP+R/jvgV/Yf9gPZLJkAJhEnwdZI9+Tv9DF1bmBAezzl7eASAUAAP78EKXiE7tcpSGgp5Axf/w6SHGw6/AgHjf1I9dHNqjgAbDA0f/uBr/+WfvcWC6/Adz3JGfSCjj/X+jYLE+c87HDXAmJhL1c9GoQclFxhYv6Jvjt13Wx8l1736Q7I9LCyLiHmkzgQQF8aY/0GDyTfpapN9dY7xNGCis3v+qMveUSCzGAJdowKR21/MpK+yQ9tZoMElRL09YtubxNRcJGcmq6RAugDQza9LoRRhoMFW4F3X9DV/u+ZlpBRKL842ZE9r/HIOLywzvj6yvRUd/caWV6FMf3Rc6pjvFQlNfSrdX5JQhKN7kkC4h84YkIgl0Od0wktetF5//1C7zksECV2NFCYxIupuNdT+jfpmxaz1f8sYSAAAA=',
  duqueine: 'data:image/webp;base64,UklGRoIDAABXRUJQVlA4WAoAAAAQAAAARwAACwAAQUxQSPIBAAANkGjbtulI692Xsqtt27Zt27Zt27Zt27Zt2+6Ok5d73+g/iIgJuNF/l5MeE5nXFm5kJM199CJLEmnOa41uu5jcjR2V4WoWCp7qMRGfb+IHvoxB2M9Z7TlawsnuclTcNXIAGUe86uRCfXROQGRZOGch/72wfgS5y9L65A210plh4e3CVQNGz3xi6toRIERFrOzxRra3LOX2qDWDlcc5Oy5pWJWVpk5vB3QVYrcY65JsrUr+02opcQ0F64IOZLxpqsVoYPYwFTo82iv5Hk74d7UQnD+AjzEJ+mPKPwj491dhVJfwcQclofAdp0Bz+XDxK0SP/ab0hUD4hUNHc4GQHFkD5EHx8b62GWNLSsA1XiQi5ROHXxiOjzxIRZ+F85I/h+tcz0yc966QmPDLcOs0Jl19GmTRJbVgK7cyULTXpbIunsL8VlqDUqs7we/1bC4XlH3U+eJgfWmo0MZQ658MOk0TEt0xRnB/d2dLqdzwdwwcPT5IVAgHnmf6+Gtla0vJPPCvEcZkGQ27HSonz/WQHFqkgaNXYN3IwH/vxgMMu9knjv+ft7EqjKxJN9E0IsD6diLw5SO+g3jiIJj334gD4yoEEJ9PnymF0TV+3Q+rv8Do2jz+k91ffOnlD0xZ/tPmpwMsnSCBYt+AkWsQ8KmkFY1p8wFWUDggagEAALAIAJ0BKkgADAA+MRaIQ6IhCZqAEAGCUATpnCg4/LngNstuAPJA6zP0AP1V6yY2gNJYyhu9gofQRzVuI1/W66fGdySm8Q7CbC7e4b2DQAD+/xB0Q5/Gtd8SPnIXmQkxE+mbcxUJ8wrPi0ElVyWrZXfGWaMYy6TtXkw//yz/u+i27fg3LrEAh+oCvfNdcuXHW7/82Yt/1KBnzIvVL6wjZ/CvvrCervtsClQsCLnXKZ8wo0orsJtZ/i1pDuVtfWJjXGalX5M0I/QhSm56LTLR85jv5mXk5VUbzY35WcEPwMAAi53hX7HjFxYhb5t4ZG8C15ANDXhd2sH+wq+Fen0CHcX/xAQl/LJxjRH6DoH/gz9NfJei330LHyQtpITUHPMmwIZuWTugjnLPoi8dPWe7BfKNqikkAKReCURJtXqpGZmVWj1k0vA1xMzKt9ZfC5zlXIwSbv99mp0+f91fXd2nsJPQlnMvtfbtzgAA',
  ferrari: 'data:image/webp;base64,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',
  ford: 'data:image/webp;base64,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',
  genesis: 'data:image/webp;base64,UklGRh4EAABXRUJQVlA4WAoAAAAQAAAARwAAEAAAQUxQSIgBAAAFoYzof0CWtm1nJL1R20iuLh61bdvdp72C3pK9Ai7Btu1pM2gm89egXLWAiAmYAATX0mIEiRbgxrZtNwJEiMCjgUt7tBmUhQXbzIJd43Gu6NFUDBpBsAgKWNCA4StDri0zvoHVbzO25EvhjwE0C6AQLIJgUDQgEP3GuwaF5gAry6AuPhaBVRUHVCzKFw5DQ/i4EeUTEQ7Mgtx7QYCdxJtrIcwgHPEpyg0fhMaHhQpYBMFRgdVFzSrUsubptart2NPJG3TaUyHEhkIPPO9BoQ00EAxpdcTTjrQaIgAAnRZPplzxpCtTnrTQAatB8sSZ94tI5Qkq0S/z4uQJAnZSWEnqHRtDuNuHcdvqJWFRwFEKL0qMaLMuuM+FWdF4OpEo4OQAscwU1+6IXCe6c01hFisAuFhQjLPvxBeN8zRfTuzjFBOAWzIC6ZS5Me+Jc2QjOFl0AjHAfSkhdCIEEW1T2KfYJgokiBAJ3J+mk+Sb7IFE8p9E8kD2LYkODTyXl0Znx4pZVyKl4YGLAVZQOCBwAgAAsA4AnQEqSAARAD4xFolDoiEhEzUAIAMEtIBqK7+P7J+I3WWeAT5X8t457hb++ZJH8y/wdsCxjeeP/c/cz7RPob/o+4H/LP6P/k+wN+zPsifrcSihZwOGi1svLpQxpWy1cVOZA16hp1CowDu5JefkvxYryHN16eh5Vzw3yIEAAP7Yd2jt/4NHW3RrHCuLEE7IiXl25XFArYUEm35rTDYSXo+ly/4EIEU06FnvzT00WJIliDyQce39pwL/nDDNz7V2jpbc/fZVOn4m7DM0D3hCqDFACHTEH9suU4NIkXKv/nSQfMhSWGva33ms2XBe4k71KLB/EOZo3YlO9xFXQWjnA5DhoWyf0Z1bGXWQctdvTHRr74VQ8XVkNkuwsenRB8dvPXpReuuUqdo4JW5mqk7hPfU8WnlvZ+87ZZmNx0bwSn7olA3AIUgGkr+LDqauve85Av+RouBZESi1iZiTXqkSgdcw18/mCpAKsJ6/icAJQ4z7Iv09gxtZ3jt6FwfB+F0dfKpmIjFW4o5rUF4npdAYsgGBqYEwEbPzZqdrzDOFYyAMFNCucSRmbXOIbGxylnYA1jqRAimyjYpe10hLKgHGDdQDjG1unBTrK/Q1SQv8YTPvTtloxHkhu6C/9Ew9f6qinjcJHKsEuFznNcYyrTkgsthvzNeZa2601GtMkQIpWrU/7PbU/36CscKckXqRlPKFvf34akTqlmjzNJAeMj/9Jp42oqHPNfxYdU4wDVQzBVeaggOoZzI8alZv4nCDmLvyPlF62Qu9X8OoijfWHI2+tIGmyZC9A51/4t8inON6oft1DSg/9/8xfB6sYHcAkAAA',
  ginetta: 'data:image/webp;base64,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',
  glickenhaus: 'data:image/webp;base64,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',
  holden: 'data:image/webp;base64,UklGRq4RAABXRUJQVlA4WAoAAAAQAAAARwAARwAAQUxQSK0GAAABJAFJisqIiMbatm2HJMk7eiJLjVmPbdu2rVrbtm3v2LZt27bNtqpLWRnX9SEi3oiqjYgJgGJt2zLlncHd9uDuVA7NtbEIVuHswK1BGkgcokN28lRcx547fL+whIiYALjZth173h8xOtsl2z81B/h3iZMFnCqd7Wxg2+psO+99F5+/b4GImIAY164ld/7pafc++fzzj997yS/3WLYr/i+zVf/6yLuDuWI5g+8+8u+1WhNtzb892gEbzJ/+33rZxOna5dIBFRvFhVfu3j0xWpvdSFGVwWnPPXr3HXfc/ehL0wcpqHD7Zl0TYLFjc1Bl8I2LP7Pi1KicutzHz3h+MLcIpy81bjvPt5T5v54aDU76wYxcFQf2G5/uM9uqcP+2k6PJ3skxaZOrOiqOndMah6UfByW/b4e+qJ/1rfbvN29tRXRvekOuwqOLNbbV+6LM+FpPpPatuOOnvvev4y+89Y0xvT6LiOjqfx3FN9dvaMfZoGPXrhDV2bKfP/OVgRzA0hOjfNFzRhWmb9bINgtAR/6URfVKJywE05/vKYv44YDCnPUbWH666tBBUd36xQiqFIBC/tNWRWy/QOHVRUP1PSc6tm0kLjqqIpZZmv+7uyLWais8khXmFtHhbbOqSV95IlfFciiRKyZVxDoDSr4b4mtj6vAhUTn5ey90rFshF3VVxNbzlMREoGVH1c6fo3LHB7E+qMCCuz5QFd9tqz6rAvRepXJ9d9mkX45ifUqUub9aNCE7BdFWtt8eKtOWjPI/YYOAlby7a1YRU14A0evT81jha1G5cV4LwOT8jL6K2BPQcdTrIJQ7+qqyfdrqwvlUAFiT+yZXdJ0rlO73aN2o5jtH6m87dvZd9G9jJQAmg/KHilg3BdqPOFvmyl09SdkxOZ+I7L95mbVx8MHeimxTKFHvnKqyVaRPucvfRHS/RFNcvnpUV2dAi2bR95o6e0qNWOu+z/3sA3FpU5p/OiHnAXSTZbFDB/lL1P6+vvanGSrNOG3RKpvKoN8Wi5PBocXrfeR9y1MAqvhhQsEb0qzFo+hbWb34DiWA1SAVPt1bZfegE8tmoZdGgyuPqQCmAlR09kqYB8UjK7Y172+i5w0FMD2FMxPaEvBX+jV0ZKkm4rBpbcB6lPl6X1XuG2j4ZHRaNPrRW8BSIIkydq+ye9DcvepzZR/ccM/+/j02WWPp3q4s4jCxGspM8dqEKyD2Enp3IfvVQAeg0x6eP+OpY3/VwSTKpKjAvA9VHQAXc9DbIj72gyc6WARQcgqUCaSBcl2rYhv0ULg6tnvXmhQLJFBiAVHHvpKVrQBPJa1nqaM2ZoGCo7skvYfe1v2yTVhCiQAFsKTYeWhqyQ7w8BR6XxzcVqlRCpCAoGJJ+5bdsig9BF3dgj4f8Y1Rwbk3n3/Js8NQAlJasJAsA6tF5TUodgI6PSJWv5185lsvP3Htf7Ze87dzC1KdIJaosuAHXWVPoLkv5jqyYnbgdXPB0rFnD1v/s8+KCiggggpgYv7E95cIs9w3yAwv3UYOu7tjMjP/ttKP5iAWxpUZl820TqfRb2k2DRVIUp7aZKlbc3D8kQSKR+IhFawL87bpemNCiMOJxRGiUEcYWffX+YQRCxabjtiIsmDZJ2BCAH9tFt3PNca1G8+E8ZNzm2URR6NCPWHP/UagCsZBy2YR64+qNiHXdP84T6IRBCTqnOwyEWhicM2pL6S0x2Ev4sQeuSo0wHfjZyk3QwMIyvSZZ9c9Kk3IqfHJKtoHjZBaBiKOol6xNWoz97W+nfBez4WARQRUCqjbfHsuUm3k9Z6jE86KZS6YD0q5UqKVbL9YZliVBt6b8kBCf0S2xO5f/Nlff/2TLx/8xTNGKSrPVRb0a2MFGlhmbgWDy0V69suCmhiw4FeIQq1XdrAEubhVI7YFFHYsZO8zoJIG9xyOxc4YG0Tdr4LCA9EwscI7UkHitcNl519/WKvOB15C8YVFLfw2C0BJHxzA4vCqK7aiZnYmCrPWiv/ccRaoZSZzctRe+oqOwnubRbNbTANFwGTeXbZO95feR+GVNaPppZ7N0QIk0O6P9L7t7kKl88BHo/nAgV+AVABQgSx36QrxzYAk8NXuFpb63wGQVKi3uYTOyKoXSRLAQ6mwOrFXAiSpwv/6QKF0haf5O84+QZLAf3OUsN7rm5MAqATk2dr89PTs2tHtJ1UB/E/lu4UtA8omvqCkYShfews9wraugoa9fwBGAPyt1mQLm7tzmtcuPySgBsi38+WaTJdwpDe5tGpkYWdnZ3t2qKooxi0sBQBWUDgg2goAABAsAJ0BKkgASAA+MRSIQqIhIRerVdggAwSygFiPhIkH0HN1XlBnv83ux+e19Hv+282brFt5s8jPNAP5L2d/1Xwf/D/kf6z+Rn9U9Y91B9ffxP9r/b38vPin+5+APvC/ofUC/Ev49/evyo/Lv5gIQ++/1X/VfkB8BHrp80/yn90/cP/Ac631A/sXuAfyH+o/6b8vvf3/JeB99X/4nsAfzz+vf7z/B/2T9iPpI/ff95/ffyO9nH5Z/bf97/kP3h+gP+Q/z7/Q/3X/D/97/Cf//6h/Xd+1HsX/rG2LvYv14Pc0GJ4SleZls1ZChYXe57YDkwkxmcMfsdBd+fmfpkqdnm8ARU+dGnvFU2ZyZ6bsBqC9lrIzWTu3IwUIO7FqJRdY3jAEgngwavzJs1KBSGBBNNWxTtSiGkFMJN7G7s3QL260k07qumNoBdAtqY3ztTAqebyd4D/e3wBPgRtCX9yb6qtfjDSusEyUPeAA/v+5Fw5YAyZqoAxrcTBRnEbXSAQcTbPmJvwfybNTcHsmUhv8/g2b+l2mM+nk/vbGgFGpKKgdejsb+EOjVGHsuZ8PbyYui4BnWBJrXOmtBrJc40Lpe4xJjWN/S03Bhzxfq6x4gAhfb3qBTqJ9kfuc6yu0TxiMJ7MwyD3kQNnzpjx8b/7FCwluFoTiZwZdj5GJmGFVmQf2MSswihJbkDcvcRlCNADFz+yDsBQ0K2ZyXcMPUgT4nLmbKYYQ5r5yo7vf4ky+rDw8ceTohnqc0Pes43o8t12b7UoGjaknDVdTX9PJgzp+oxZB8X1L0hTGoW79BH7EagxXz3W8lqbIXYixScFBQdMqya+zGClayY8qfS/SzHs+QONQzvqUxC1nB9IMrZL4pUpbFIu45iM2Jh/WD1MatI7il6AkKpM6RfnxlyKicxYqr2kYwVz0uJWO5/FMoCEnqFBMsts1TdkoUFVNlshFNugdwoFeefulpKt8axpn1H0EpF/dCIptxtglH1HxegBUbg3U09ATa2qru4xZHjXR+/7IcjY7Kqv4kgvUIZ0/x+uDzFoVo4AQiFUl5bO09vCr+5LDpXAc6nziV/FrzSMLjxT1aL7nildmMe3F6HzLvDfrxv62azZvUWNevdLsJVGWHv+gQf//+fS5r4E9W2Xv4/glBrSo6flfiwvW7ZZ/HCs2+2reBruxv6Wm4L8t+GPiwcsxi9KuXEMWnOceKIyJ82guq00u/px2jd3lnUYc7n/dp3mab3czUN90ji+NOd/7IucFLKWpq7/Apx+QI4vHnwojNLelbXgJ3GXKRdZE6rEHjx7Q+Bme7lJViGqv1/YMxkBPwqq9GP+wdKctle5eaResDSx4NOh3yfPs0jsRR7CPHLnhltbMO0M7u6HKeN97I8v9CaF/+h3syHjDIW1UQKmaGab3UWDxoV3wSF2zPOojD6HbejvzGMCmUePpg603+U3NtJ6J2le5Ku2ssX5jvwRcShLT99nRzLi+X1tBdNzrRgW7YrXtNPxGGq+N/0JkrC5BmqLPhkVIdSE7weE5TeRL4EXaNnGXb/OKrfMsPQ6ajfyL8diC1IF2luj+YA5/YqjDwqFTI4D0MSow6F4DAkK9uJhrPIm2UrGodnPM9MECqS6QKdHZINfDo5BZKr3ddQS/eh0BbTDLx6vpNhasxlTkUY9LNnhYlOXYS+6UiX4dFHiuTSDeTA0YH/+EEvRo5xysS6ev/+ZhBvr9S70VnXAPi8YehoApNdujrYqmuTYioLb+Tpy1wSiRwNNO1ViscnBOkFW6ZnZEabMdlo8Ld5sjWf7tv9bg5fzqURZF0XUrg6V+S87r/hebzSfvJ3zPyHWk7qhRLps6R5dbDvC/uittCQL1/4OJfqTClZlkkhCFfUR/MlDeUpQJV2/82yJuOnqe7b4Xkv/x385h0XniOLLibfQfmYn3rsnXpFoY327aPOCpPZmuOld7oWPhINwbILJY7jhAavS0PMb2AgWK7MEVllwp14QiYbRcR6ChM+Bca7REahYQlzOj+osPs0JBjR0010eBltn5dMbBdMqI2ovU+OxrKDeL6pPi+0OxN21V4WTt6clL6jT24blN3Py5EbTBbVpejCdvgX/mKaYd0eMMj1emVhMds1WEip4dxgVlKwBefokPuSy6W3a8nT/k2XZMtWyNnK5iLLhevfJq8C1znh2/lmx0Yoob1Uu77Kjsf4RxXfxZ8rXSBf6kfYNO3ZkKhc4vG89Ezv3S68L566aB9uks2p0gymowYG9xsryB25VxUotJNeqIGITjI3+iZbksvh1AjXH7H5/pvInkFiXt5JqGzvpiIZRlSLOeBfxKc+B9/f9fz0aqFKFLslDPMrDa6rH0pENX+2AsZ0pfz9HOhWwz8FCQVITyNOGHzW9T06lOTx1TOrgODQpcKY60y2tVcOSYN361GitgXnErzlWMY9n0Uh7tFuUZG3c+NnRultsqOJkfhV2rJiJ9UvcbGYRZd5dg85IxZjh3m2/R2KelWgWHaNh9eAhwSyhwkkXrYHveGZEjboZiftulWgX1lpEcrxVVKr+moIrpudz+Bc3Wpwe5EuY0mZNdjQAGhJICR1oakpaSEzmCSEUVbzhOyJAuB/mG2lHqxTVaBgn4JfvP34t/VsTEqf24GyzWwf+HVwT8RuSH0NX0tYOdwASCAHJtxxxp5ReNmckRTm9EpgTFNrQcN6dvPlVGVTBQO/nemfXt907J/68neFFgQBcW850U96hN7MMUlAeMnwnEBdptuMEYQPhXeH3t1H3ggw2yB1qoZITcFBuYeub1u9whK89Mzx4+GWLE29vHc2a5DLJ7wig8ZecHRS1F48NaNgsqtcgCJRgCmu1JEBazfq6gHG+WZ1yNllTJwsj41Krjg3TIGb3AD6/9ZtGge8Kr9dK0fPChdOUNK/Mf0kHF7cY2Xnw6m+iDmYg8r2ls3+JWujJrp5WXtA0PxTqXW1mZ2JGn9DG3rIvyLzRxshYNYWXpmRCBk+8sr41NYygaGNb5ubMeu49tshD+CBznWfvfyMyWPkjnj+IsDktdV+LpHWl9yxjUdBEsL8vksJYZpAfynVE3FqmnUZzyIjyppz5qGEePQ56BSTkweKQNGO1kQm5qcsdGknbelJeGWH28BztlmHmE3or54il0kJdC77lfHqNbVPin/Ohv/hsihsvuaoH/KJodzBhCYmbfYoJgBNMAW2dWGdzbS4jdXX1noR/hR6UbUSImh4LeRXoMCV1QmlxhuzcKy67oaXjHPWq+KTwwkNtfeCS2ltCs5PqnRpTNv2lupwvZAKE8QYNxovX1HBLnCB1fkLlClXDDRanvqM6TkwOdNVTkIxcB56KY/kttYowoYepnp/xTf//yXT2FynIGdOT0L8b5gocCx3HMyQdL1Hnqm6ZcK+oGxT2xjdv4W8gGzhxITprrgF1NY2tOYtfa80aP520It8ozXUV1Cj9ja51P4Add2uTptlQgEZSlQfcLsL2T3Dnl9HVOId2QQGCrlB9k0eARf+udocOPz+wHUBaPMKhVr3PJIp2+Z/My9QiXN23Sl541vxPtyYzM3pVvd84XBpWRCc+u0vv2a1plofKFTRbsZuQOffzWupkhBxz/04wcQJzsQ/3jeCZ6271RcLkS8ZHCS5T+R35o+rGC+WQSzPyc+v8CI3djcnFc25Brp20v2gqBnMyZ3iNYt+vPhR64OH/7f0AAAAAAAA==',
  honda: 'data:image/webp;base64,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',
  hyundai: 'data:image/webp;base64,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',
  isotta: 'data:image/webp;base64,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',
  kia: 'data:image/webp;base64,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',
  lamborghini: 'data:image/webp;base64,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',
  lexus: 'data:image/webp;base64,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',
  ligier: 'data:image/webp;base64,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',
  lotus: 'data:image/webp;base64,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',
  mazda: 'data:image/webp;base64,UklGRpAMAABXRUJQVlA4WAoAAAAQAAAARwAAOQAAQUxQSEAFAAAB8HZr2zFJ2rbPaDsiIp1lu7r7ZNu2bdu2bdu2bdu2zUKyjMSxrcuHfT8ijoyImADLvThsiQ2OvOqJ9z+b1NLS0vL9Z+8+fP1x6y8xtmjVXPz/fg/+2DqnOwVEtqS0a27Lry8esXCpKhrXvv2XOSJUPFAcSfI5vz69c7++mnDuj91ISMpyd1foEiAh4f9c/d+kD8Zd1k4oCZTO/PWdu6484+C9wuOuvvftH9pdEhLhjDv+lVfD/h2EAjTj4yvWn9CQWPl1o9a/6t3pLhBhxzENuYx+ilBA7z/nTSha3qNP+7EHEIBeHZ7DwpMBBGjSBkXr09K6v4jM1hEVrd0BIKDngmbr8+aTugGFMyZWsNQUieg/qydWhclSvxIKnzSxrEE/I5eAjxayKh3xnkBy6dMhZSTPKc5n46xq+78Fcpe4tJS1UyoCb1vIqnjEF5LcoWfdjIEzESB1rWFVvdxMyQV6uzGSXEQEPZBUlx0pgSQdGBmhDGatX139HxSx7+qCAyiz96uNClUz4IJORQDf1sz6/w5IEej+dK+6akiWvLPTAUeS4HkzW5YAFIH017PH99WQA9+dR1Qi2jnC7JQgVAzUefOShfySFa/+W1Qo+UFW+wagiBQD5j6+Rm0+dRu+OI+KJfGSjZmdhZS6YtD9/Aqlymo3+M7JVDnAX8XlKFNK09RdgaTeJ4ZXMvElEZcoN5gzfO+sd+ZJnrpLUgQ6lihvk5mAQrJnXE5ca5+aoeXGndPhaequKOHcPZOs5Ji5gBDZmnTWiNERSYdcCwjoWtBs2A7Pz0wzJAHdexdiyfHdlC3/8/oNB5kNlrtL0i23Z3QMNTMrLrTXMy29GQK6dkwiu84HFPOW5w5YboCFzZ7x6AMZUwYGZpYM3/yOn7siAqatFCwzExBh++M7jLDsJlf80fsBLy+sXf3BSYFAXw8xGziJuP95xlgru1GSkPvjN+VjZkOumoHLkW5MijcR9c4Tm63CJg/c/fELAbnUOaQSs9FvCUnqWmVhQEp7XxpqFTcH4fVnRdJ01tjKrOYoIcl/+xopTbv2K1rlg5R5yQEAktLFcrDCVvORJIRr2nqJ5ThccpfLd10vcEkb52G2YxcR17x1EstzWXd3pWnv8gtH3P34fOyYHhT27JRYrjsrdJ89fOBUQJLfm1PpIUCuW2ss18KtEkhMLZWei+mT2nxszBRQOnuU5dvwB/EPzE4kqlkTc7JjhPz8JKcJKIRLzZaLwfF59fsBdY20nHcVIPAlzQZMBgS8l+RkR6OvCznVf0Tstzqz5AJJSJr3/7xGt/sulvPynnGdmdl/XRLAE3klR7xan1PpQQDBnEWDmhcz5i2VkxVqLOc1egLgwUJgC6dE+K4xp9z7vwcgmLu0RYvPiPhZhWoqXE7GNUnM6ltAAtKNk+pJ9kkDwc/DLHud+RJI6tmoevbqId6zjJV7Wq+7QJq9T1IdxTO6AQS+dVJWzbWpJCHNv7KpCpKJL4m4H1i08msv6Y7BJ9vU9FEy7sJWAAlm7VywSgtHzZQkgPT1XYYV82tY4dI2QAL051qW58qfu1yEmn3fXsuMbSgVyivUNE1c6+SvUoUAXY8Nt3xL57SkqYuo5H88cf0JB2636QZrrbX2Jjvtd8JNr/zlioKg97tNLP+6yztTSSJb5YLKhPSvHRPry6Ru288FCEXKVBRJAOlTixatz2vH7fZKl4hKAiSBJKKaeu+mQ4pWnaVhS+x390edEhVKbW/dstPCAwpW1Un90H+vuNG+R591zZU333zFpaccvccWK/1rcE1iuQNWUDggKgcAAHAiAJ0BKkgAOgA+MRSIQyIhIRQLNiAgAwS0gGWaIAfwD8AO97+pfjX5x/h/yT9G/IT9y9Aj9j/xX9V/bn0g74/a//AeoF+Mfxv+wflbwBVXPQC9a/mP+Q/KHzbdQLuH6LP6l/j/SnvU/MfYA/I/+s+6X6Vf4v/c/5P8qvZ3+b/3b/a/4n4A/4x/OP85/b/8l/5P8f8yHru/aj2Mf1bOVnoSsCQ40PU9fFMF/055wFmzR8fzP9Ww92sC4wwVcae6CPKVjffevRuZx4dww+nE6P3YnBhD4b/rkGB0sXvm5209fqk804idP9SaePA/M2tmo/71Ie25QdEF/jje5Yl/+blADpvpzQchdvylaClh9w6m6gN5U75cYFP9/6cAAP79B2bCw3xdF+pdy+6iq4PyWhu+vWod1Sn61OHj20RwmNeVb9NbGAD/PbeT00JFKNXO7/Z/tJaPjtjhsYa4pbBNGTOJZd0fqJTBDZAGxOFonP5p/OpD0zpoaiBtpgGKh/TjzN8sF0d+9I4kP4skW439qTV9Eky//Gl/Dcvz30yFtuibubB4bX5BF6ZKb8n4N839ngr/097njgvZgtw3qGBaV+PYpM4eBnUgXRmXvzERNHIaCKnS0IOP6dSNCW41A6LgF6ZNWyk/i1n/Q8zilt777XpPBRw8vxGu1cPxHcx29GvCGEzKc8Oa+T2iK6gd/zGBX4wT00Vn2eu1KNBJCHwLwlYsSdFAs45oenOIfVOBImBo1HB2WFO/LoxyNFfcYmWZK04aFoPKPTuuc9dN083S6emA95qH389C8pbgQEbqRaa3THCdzRsQWn7zHMpXuu19weDrH/6vuSWpE4mwS9ZW3i/ti5iNKsbVMLVUEPusKhNyv4xEzOKRvxhC30V83uoe9arftBOQqL96mTGyHUaCYO/exD3wDrx6v5SmFZvr1KCL+GgvHsWDQbsf9RnWcQPT0s8EOj1sDtfnXtM10uiMj8iS27YIht7hMgRw4UTdItTAhYaquCHQ/ayy2j53NQALC53XEJYmo7S4SlVu0EvCjt8D+0TeFBYes9IuGQ2UjUZv8GGQk4ew3qBLM8ZQUrmFMfJ7zOdNS3r4ggKtdzzQbIIO/l3ZmwaZ9gQ5bYks8xbKQvv4pzw0QqOlMA53vYh9ea3j7TVoplDz/FRneDK26rt1EKaMz/l5NQb/gJwSCZzu9CcBUAVXe5evNubkkMhT9kXQUs40Xl5l3pkQTMXJxa8aMjaJosfxs12Diy1SFPoCAJjQBFzCmyVzEy4MTFn97od5YC/Z0XMR2DwDtbND8xaArWR1jPgNvAs+1nSIVTrEansN3Qt0zcdkEyGSzN0RITTT2eotTLzUNS0bOQfPjJFWqUsLOYYv6xaK3w/CLqvhrPyefKKzzULtlukzspRiZgXeZtfZrJvq9AfsJivmM2EXzmCc2u/I+1REz25Ra0npFXcjhlECXLS8Rr7vUXxICyqvWP91Wuz6uKz5iS2+NAgr9W5kTw1qfo22OAYrBuP3+lxyADsmylUd4E2mnvPOQViGK/hXrTLdaLg2YAAXEQN/FfpWxrvX6SPcx3+rk/ZCRn4vQnU6w3LbWaLwwpG1syUTy1diISQyCKaOIUEvEB+FHnSFBobUWHPO74UypTjzSwLQ3KA3Hu0J+sqg1+mvoI5oFlq1MKmdGlKMqOqPNqimt2Wqk2dvSQOOq4Qf+m7bH8f9SC36NKsh3SW9PgxfoLqNJSUxFfqaP+1+kHb0RNHoANZ4UGW8Og8izYrEvduZW+C09Uk/gyQSB6ewfQF8MU2sfuSpRC9FrfeyV3DKhv11rIrP8fBtWDdc9Hee+TVwa35yp/INg2KI8DRlsUxdQ0W36M18pucv0ETmJd+SevH1Q/v3KWEqBxpj6TAxRxnepr4/nyvf1FGVijxiIH5TRu1Jl0eYBNxMT/fNlRz//+54imV+x+zjnFLEtNynNHeTz4khqH0jKqVC64v1U00oC/UcOyD6jblU0THTlCLjgCBAKToq7+SBXSRbpI9SXmxq7EKzlhx/XCtTYtWxwrCfIg7h8LjI+KTho0N+eG/+of8rEZNcfsWHClgQhv9FZocbasphfmd/j9WCGPY876qfEmgyDa6RYFXF9/f2B7KmcVOPiP/tmmC+uM6640Ylv6H7/izMAia+JxQ2gLzvw0OW5X1+ZfMabEeUQTMz+kYrbK1f5I2GH9w7Z5uYSc/wDtizf8mpeNvvYYXDyPfuG89Ojilc9TO23haNaXhGLw9tA3smXJMpsUTThtBI+jQvzWJiESs8dfGXh/p0Dpq/dX5V5HIyAcWYeix4sT9hltcoz079CJ5+UZDzb1BUEXumj8nyXnmAeX66qLUjIl81bWIoJ0kEjK3njTzZ3myqb6T4Sf3UCYvA2PX0K8JTytrDbIvRxLOBRapPNEcPIMYqXvYhIsq0gyngAAAAAAA=',
  mclaren: 'data:image/webp;base64,UklGRhIDAABXRUJQVlA4WAoAAAAQAAAARwAACgAAQUxQSMwBAAANkC1JtmlbPefatr33Wde2bVuvtm3b1pNt27Zt+x5ja+ni+PxAREwA8jxToVX1Asr3k/IWsRRu2UkAILH585S+bS23hP9J8HEeog1GX9q+N1yiEgWk87HpMaydef+N2FnFp08ZqMrK0p5FcqL0gyY8EHxacrE+enEr0jV0aaLm1+4qN4gVtm0qXkIFQLy2QPdu0i95J+d/KVde1WeBlP21i8oB8fdld+mHsZU14dcPuOusY8c5pGsezwEiV36oCHC1Bidx/00NEpGTlD28AKFqzcLRQSD2RZtIVCByg+J4TRBAadp62J42ksf/1DNbCicbUGsUH1QBw4D9awUwxWwAEJmQxkDXv2jpH2GgC04Da/brtxjNscDe833K2T03y7dBurRBP3xfXb4t01zcpG4HYgXuplKQAgpQFSnUn7y8HP4GIuOAS6gPVC2ReiD2xTgNbt/SdqYy+U6SDu1cXfo5V9ZbC3HFp2E+SFdrYkArQOyVgPxTrduTobciCUHeAAB3K8BlFkPKX4kEQEhJEfyMdPs5Pr8eC6SkSoe/EyaZGJcbm+TPTyB9/C5oiysOP6+avzj369MelxbwYIajIesC5JE3qTAhLR4GGdIHVlA4ICABAAAwBwCdASpIAAsAPjEUiEKiISEWZVQgAwSgC7M5a6HYZ7yl5MCeA9qD1UWLS4hnVWuEz5g7h+p37NWctdOZMjh/zQAA/v9jwSFB6pJvEzGUmJwOmuAg8VImOvAYZtRIKsekdY+MB19IEEmaX9t+axAZ2DRlxIUQK5o3bv44YXUuQYAOOuaSwRtach/FapHKirqPGK3zVn3hN5Q4wTh6vTIRIdJcXEJOHfwfNAndaDlkjdRl3ek1lgyhoy6EHuw5k34o9E1upDLf/4mP/LnwD/JS15P9nag+ivq8ayeH7WfiG4Z8kFBeaWIq+auCv5PxXw/LD26YLG5vlASsLuYNFP//sQ/+f3n+Qp/n/Wn+bB/Fq2Xwrc9zUWzVmiN8f+AAAAA=',
  mercedes: 'data:image/webp;base64,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',
  nissan: 'data:image/webp;base64,UklGRmAFAABXRUJQVlA4WAoAAAAQAAAARwAAOwAAQUxQSAoFAAABoIVt2xlJev+k2NUae3ps27ZtrG0N1mgM1rZt2421+hqbhWZpN13J/30HyXSnsjqNiAlAWkVg+KZnvy3ft6+8+NlNIwMCf0vRZl7RVxU6ERMRMZEe+aZwXjvhuPa3701IZpJkaJqm6SSJWSb2395ZOMnVd2tYEqWOlT57zZIR3Tt06D5iyTXPlB6tI5Lhrf1djsm9+YBkir+7vk8TN+rpatJn3VtxYnno5lxnKCN/lCyDz/VXYKPS/7mTkumX0aoDMq8+QhS9d6gKm9Uhd9YQHd+clTbvXQbLXROQ1nE7DTYe9Kep3Qsax+9vjzS3vzPG+qvt0pL1hmTjci/S7j7PYPlmdhqy7qrjk+sUOFBZfZz1R7Ntc91Wx9o6FY5UV/3F+javXTPDHL9EgUPFBVGuWmBT419J367CsWpBine2ssXzANFPbeDglt8RPeW1Y3wF14yDo0dUcNU0Ox4jWQSH32jwy6Jhfat5b0+nddvFsTENCpQR3a84TdlG9GtuPXzNugyd+6rB8f5wfI8Y07uLR/ZsFTBdX37gZFSXxhuK85SXmCkZObK7yDRwrnUe/oatx1n3NP1fbdy2kTCJNtkAAm1zTKr/lIrJ5bf2CSu1TZNTZLdtJkxK28YvxffPMfWJ5gM4I7ZZAIM+DUUsd/QAMLUsHLH8uqVFxkOJ4ASr/Hj0Gg+A9rXPv0FG1SwA/YxtAM6W1wuId1LP5FtuagmgpO6xfMtLciymVKX0HS0stpGRvFIAedqrb2n5NSfmNsD9e6R7O3MLFwDP0aNd25mbKTBnflp35SupzcLCuGivvsFvelPrfqF2Ykb9sCV1cJe5/I4sQDyp79tl/n2DD4C4MfW6b0DtsQ5W/aaEohtEnvbqW1qeuKC6Ymb/ejXZ9nVxcXFxyfHkCgB5D35TXFxcXFZRNQ7AsKrQpObNC4yPM60w9mBqQ3ft1Te1PPgu0g5cUS+ofnPG5fpNAKD6zZlb9bWA+oJM/PL99+WGcb5ihckHa26ve/UtLQ8QZ0Ul1Wfd3Zb37dHOAHDe3ZYPnohNg5itnfzoww8//PAb/fe2p8DkiKRXX6puD8B9UXUsH8CZ0Q0CeDAYCoaCodCRB1sAeDkUDIZCodCh/Bx02XV0kmrOeKymSCC/ujcATNsRe8GXqQCAyMj0AHBnugF4/NZeAQBev7VXAK5MP6zVzAzAExAmeDN9+B87cK513t+h9Tjrnqbryw+ciOrSeFt1nvIiMSUjh3YVmHzNugyZ84LByQHO6xVlenfxiG6tMkyW/q+J7lecptxB9GsuGtq7gvf1dlr33Rwbg4Y/KmWR0/INflnYMDbCtVOdNbqGq6fDRvc9xL+3d1KbH4me89mBxj+TfofLOeq2FO9sBXunhzlxteIU5YI4Vy2AzeotKdZOV52hrtZYv9NrFwK313HwTMUJyrqTbDyaDfsDL0k2NvjS573cYPl2DtLZ7imNE492FmnqcH+c9dfbIb2eO1Is909Jz4Rdko0H/Eh35tVHJMUeHOGyyzXs3ijRyRuykH5leKlkGX5xpMsOZeiLYcn0y3gVjsy5ab9k+vPTswa28NTH06T/GR8lieXh7Y3gVFevwiAR66EfX7xl3dj+nTr1H7vuhhdLT6SYZOT2/m44uc3texKSmSTJlKalJElilomDt3cWcLhoPe+2TyM6ERMRMZFe9U3BvPYCf8/A8I1PfV2+b1958bObRmYKpBVWUDggMAAAALADAJ0BKkgAPAA+MRiLRCIhoRDUACADBLSAAAY6cOHDhw4cOFYAAP7+fJQAAAAAAA==',
  oreca: 'data:image/webp;base64,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',
  peugeot: 'data:image/webp;base64,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',
  pontiac: 'data:image/webp;base64,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',
  porsche: 'data:image/webp;base64,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',
  radical: 'data:image/webp;base64,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',
  ram: 'data:image/webp;base64,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',
  renault: 'data:image/webp;base64,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',
  ruf: 'data:image/webp;base64,UklGRgIFAABXRUJQVlA4WAoAAAAQAAAARwAAHwAAQUxQSN8CAAABkChJsmlbvQ+vn23btm3btm3btm3btm37HV/vPQ+zzl7n3h+IiAmA2L/bzl1eb++SxAQA+becZueZAJS7eVv/9bZmKAq8zX6JdGp3OiQGLP0i6H+tKwBlA0l8XhYhObKnN4qMrZ16iH4tTINEx4j9lAhAlt8S1K3xLA06dKmbUxSyhSSGrg0q6uBmA8BskmhvoxQo0KlR2Q6irHYZpI3M95Vx5weQ0CbjcRKUSzVqbKGuookk11V8tvrfvjiA0kuVMQmIX79JkSrVBAneSKIldb4SUWhnE5DgOEl0ZAaQpUTJ4oGC1ioT9e0d/8HNPSp3i4ju5AdQ/b0g9NM78RIDAATEM4M3XyP2Uk4jH7BCZT7UvkSkLgsG/OZGc9qSeEaxAr1VbYx6oH4dvttDYt9UvkL0vTmAvLeId00tJSyZXJd1QSQj80yll0RX0gCmjh6BFhkm/NbAoCfHVZKtde8SStp4AxBnH0k8lwU6lfYOaSdSnSQKzwEgr1tC1CSLnkQbSXLUraxDo4mOGQBlMUl8WwV6C7+RZN9SeVgoUWQVAGl/StAOJ9SjjIiWYj/cofxiJxFdswIYTRIjeil6rI9I/+utffKm730vgojUPgASPpLxMxn01laZb5dVL7aEwHCB2Pe5ADRzCo41qCYuCr2WC/S/tj3PCU3kHBM/RRi3IzEQZ6vK/W5hhPxiEYyzpynrTRF9G1tT4zYmhFL+ObHa0fSQrywh9m5+oMJrETlvE38/C5JuiuQcfYw+SHufiV5jBcwdf4q81C6PvakRfycV5Bu62RhbfQAIHufQ57XaHz5MvE1lbsb/DwmmR/niXHxflH1N7EDwcWdEyfuQC74crjL2pAL4T4uS5Wqq+GY7OxRexhn3U45tTDB8auAVbxCn1zsZv8cmQsy3Vjyt6nrTKg5io5J8us278K2ZjYilxtJ7PrlVItKi3Z+P1fVHLDYX7Lt8z8kTu5b2LeKPmAgAVlA4IPwBAACwCgCdASpIACAAPjEYikMiIaEU3VSQIAMEoAwqgQUxjbAbgDeAPQA8q/9sfgY/cn0aSZZ/ZvfzehB+gAXusoMAvKLnq7yz0tt/V/D7SI5Sf+OVDg3N8OtWwFO5yd5EAP7+SQ6wYkLTr2VOiq6Nvj2srgYLSSUO/3nDDQYKvVf/YL2/YNE4QHGxn3da0Oqfe1r+7fwLH4IJZiBhGVJEtW40V1XOe2lTNanF49mIhk3mWrE5Pj1l67tsSXHpf635cOsYh148YKFC4S6dHolR+xeq7865ffBxhT5L1FuFf+dcILUR+O5C8RxQt5KGIR1EpYISYdc4QwcPZfUrHkjlMAWhkIC5kA4gXvmu3/Q1Nm2qtWTW8UIvcCOBwMguxGptRSPVi49jnLufoeOf48Wa5l2g1n833sNapIqNZA+wd5oj6PSVl//Ic3TATOf9zsO6z0tgQ7ogU/kZgtqmbjqwvtztf7g/52xX+i9RDxcipPH2Qw6RoyqWBH3OeBM/S6D8EnmaEzzM9vP77bnovxSaat/s/dnPidkQeuIeH9aF/kgaPp4xbXh8YORwLTe3mxa4MTZBm/j+kdi6WPIMkFDx0tq0GAq+KgwgoIb4rOR3xgNP1wgdf54NynmQDSsr/mWR/+690HLYTNN7FD79ZuswJLQfOFzDyllt+01gAAAA',
  subaru: 'data:image/webp;base64,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',
  toyota: 'data:image/webp;base64,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',
  vanwall: 'data:image/webp;base64,UklGRkoDAABXRUJQVlA4WAoAAAAQAAAARwAACQAAQUxQSOUBAAANoCgIAAGpmmzbtm3btm3btm3bdj3btm3kWoTjJ0TEBHQ+zOBN3q7wKPeX8d2oj/HLPNcw4ExLOUaPM3FZ1h/iKf1+k4tWjGf9MI+qv4IfcoST34MOR91O97DVGRp7NIPuKPfhQxFr15oj4sWm2p5sjopvVOJNNCbOzLmPxLzqKxLU9OB9Sca6mTJ1rzWRGLf/9wgvlk9S/Mua6LGvFp9S8pGbKRt+/XUs5MjxSkduUJuRk7NOWXU/ksSvV72DwMelEyTN637iaj9kFfhOnB3uDdqryaVYiDN+WTehUXTntVsNUqb7NsLP2TKNOAtvlU9QOmzM8gR9eYaMmTyXvLyB2x7FTMX3CvmczFX8ffOLRvFGr4iwqUzlUX9GeLtc3GX+ut4m0UCO0Yircf4oXTztC7GQscQjZ+lNnGfeo9fl33FnxNYE6SNTyLs+rZJZ+BUJpzGg10/03RmzRwlOerCJNqQtjPh1rsGnazfEjfBZ5tS8YNEUAjdVQNHUaPBsEK3jEToXIn7zeJ8Uje8qedL7c0xYmQn67IpgZ+myEYLPNuC8G+VSuxPQli3Pi7M0W5Z6+4m7PyGBPvdJvCfe5sEcYxnXf+fWQLX/+CRCuP6RDHCxqW9v8lV+5yXqziYeBXqZsCIshgBWUDggPgEAABAJAJ0BKkgACgA+MRaJQyIhIRZsBAAgAwS0AE6ZQj6r0/h3NzndTwG2A3AHkzdYB6AH6zdZH+5pGs6QB+gAVaAyj5+QMlKcG1S+yq8h0OTqAAD+/iE3BFIjmp3IN7gY3o8WdTYH/i/hUQHzfU2c1F/53QVMf5hzB+NGBr/8aRLrQeLcRUpyUTXapvD8BwzHLbg6KavmGk7Nf8KgR//MpcgE735SvWoi2D9xv1l98ujWi8qOrWTWcq8WzX5I3urq6GTfbeK2LXQam3696Lle3PYWv59uzF9tI55CQ48Ywz+hZEodYzhJsQKuu2IZ6ZSAdaY6NTvvUFNqE/dYyyvDEBW54oFA+ocyUmRJu/D/rikZM34d8flp4pLGAhbrCDdaXqqq2wTfGIyFVkc/CT53LVRco1/fl4oyHsk7AcI4AA==',
  volkswagen: 'data:image/webp;base64,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',
};

function patchCarMakes(src, file) {
  const makes = Object.entries(LMU_MAKES).map(([id, re]) => `${id}:/${re}/i,`).join('');
  return mustReplace(src, 'chevrolet:/chevrolet|corvette c7|chevy/i,', `chevrolet:/chevrolet|corvette|chevy/i,${makes}`, `${file} car makes`);
}

// the widget pages: the page's class, from its URL, before anything is drawn
const COLOUR_LOGOS_JS = 'document.documentElement.classList.toggle("kapps-colour-logos","1"===new URLSearchParams(location.search).get("colourLogos"));';

// makes whose logo is only a wordmark, unreadable squeezed into a square: given more width where the logo
// column fits itself to its logos (Standings, whose window patchStandingsSizing widens to match); Relatives'
// and Standings (Legacy)'s are a fixed square. With colour off that's only LMU's makes: Kapps' glyphs keep theirs.
const WORDMARK_LOGOS = ['dallara', 'duqueine', 'glickenhaus', 'mclaren', 'vanwall'];

function patchColourLogosCss(src, file, wideWordmarks) {
  const lmu = Object.keys(LMU_MAKES).map((id) => `.kapps-icons-manufacture-${id}:before`).join(',');
  const wideLogos = WORDMARK_LOGOS.flatMap((id) => [...(id in LMU_MAKES ? [`.kapps-icons-manufacture-${id}:before`] : []), `.kapps-colour-logos .kapps-icons-manufacture-${id}:before`]);
  // the logo keeps its width, for Standings to measure and widen the column to, rather than shrinking to it
  const wide = wideWordmarks ? `${wideLogos.join(',')}{width:2.6em}.rows > .row.driver > .wrap > div.car-manufacture > .content{flex-shrink:0}` : '';
  const tile = '.kapps-colour-logos [class*="kapps-icons-manufacture-"]:before';
  const rule =
    Object.entries(BRAND_LOGOS).map(([id, uri]) => `.kapps-icons-manufacture-${id}{--kapps-logo:url(${uri})}`).join('') +
    `${lmu},${tile}{content:"";display:inline-block;width:1em;height:1em}` +
    // with colour off, the logo's shape in the theme's text colour, like Kapps' glyphs
    `${lmu}{background-color:currentColor;-webkit-mask:var(--kapps-logo) center/contain no-repeat}` +
    `${tile}{box-sizing:border-box;padding:.08em;border-radius:.18em;background:#f4f4f4 var(--kapps-logo) center/contain no-repeat content-box border-box;-webkit-mask:none}` +
    wide;
  if (src.includes(rule)) throw new Error(`${file} already contains the colour logos rule — patch already applied?`);
  return src + rule;
}

// app.js: the setting into every widget URL, and into Standings' settings for its editor's preview
function patchColourLogosAppJs(src) {
  src = mustReplace(src, '(res=params.toString()).length?', 'settingsMain.colourLogos&&params.set("colourLogos",1),(res=params.toString()).length?', 'app.js colour logos widget URLs');
  return mustReplace(
    src,
    'onClosed=function(){},electron.server.racingOverlay.openSettingsWindow(',
    'onClosed=function(){},settingsStandings2.settings.colourLogos=!!settingsMain.colourLogos,electron.server.racingOverlay.openSettingsWindow(',
    'app.js colour logos standings editor'
  );
}

function patchColourLogosEditorJs(src) {
  const preview = '(i=new URL("http://127.0.0.1:8185/racing-overlay/standings2/")).searchParams.set("test","race"),';
  return mustReplace(src, preview, `${preview}i.searchParams.set("colourLogos",r.data.colourLogos?1:0),`, 'standings2 settings.js colour logos preview');
}

function patchColourLogosSettingsHtml(src) {
  const system = '<h3 class="panel-title">System</h3>\r\n\t</div>\r\n\t<div class="panel-body">\r\n';
  return mustReplace(
    src,
    system,
    system +
      '\t\t<div class="form-group">\r\n\t\t\t<label class="col-sm-3 control-label">Car Logos</label>\r\n' +
      '\t\t\t<div class="col-sm-9"><div class="checkbox"><label><input ng-model="settingsMain.colourLogos" ng-change="saveSettings()" type="checkbox" /> Full colour</label></div></div>\r\n\t\t</div>\r\n',
    'settings.html colour logos'
  );
}

// --- Kapps bug fixes ----------------------------------------------------------------------
// Bugs in stock Kapps, found by reading its code: file -> [from, to, count (1 if left out)], each with why.
const KAPPS_FIXES = {
  'js/common-ir.js': [
    // A timed race's laps for Fuel Calc and Relatives: a slower class runs as long as the overall leader, who
    // finishes the lap in progress. The leader was looked for at Position 0, right for qualifying results but
    // not for a session's results (used when there are none), where Position starts at 1; then every class got
    // only its own pace's laps, and Fuel Calc could fuel a slower class a lap short. Now: the first result's.
    ['0===(p=results[l]).Position&&p.FastestTime>0', 'results[0].Position===(p=results[l]).Position&&p.FastestTime>0'],
    ['avgSessionLaps=0!==p.Position&&', 'avgSessionLaps=results[0].Position!==p.Position&&'],
  ],
  'apps/server/racing-overlay/standings2/worker/worker.js': [
    // Standings: an error in one telemetry watcher left the client mid-update for good, freezing the widget.
    ['(d=p[i]).cancel||this.applyWatcher(d);', 'try{(d=p[i]).cancel||this.applyWatcher(d)}catch(e){console.error(e)}'],
    // Standings' gaps on a race's grid (before results): the class (a) was never set, so all classes shared one
    // leader and car ahead, and those were only kept for cars whose position changed, so a car with an
    // unchanged position could find none and crash.
    [
      '({ppq:H}=l.gapData),H&&H.ClassPosition===B.ClassPosition||(0===B.ClassPosition&&k.set(a,B),P=k.get(a),F=E.get(a),E.set(a,B),v||0!==P.FastestLap?',
      '({ppq:H}=l.gapData),a=l.driverInfo.CarClassID,0===B.ClassPosition&&k.set(a,B),P=k.get(a),F=E.get(a),E.set(a,B),H&&H.ClassPosition===B.ClassPosition||(P&&(v||0!==P.FastestLap)?',
    ],
    // Live Standings with no qualifying results (or a car not in them), or no race results yet, crashed.
    ['S=v.find(', 'S=v&&v.find('],
    ['I=L.find(', 'I=L&&L.find('],
    ['t.gain=S.ClassPosition-g.position', 't.gain=S?S.ClassPosition-g.position:null'],
  ],
  'apps/server/fuel-calc/fuel-calc.js': [
    // Fuel Calc kept asking the main window for its settings every 200 ms after a reconnect (as the overlay page)
    ['return requestUpdateURLParams(),requestUpdateURLParamsInterval=setInterval(', 'return clearInterval(requestUpdateURLParamsInterval),requestUpdateURLParams(),requestUpdateURLParamsInterval=setInterval('],
  ],
  'apps/server/racing-overlay/car-left-right/car-left-right.js': [
    // Car Left Right placed the car alongside from the nearest car by lap distance, counting cars in the pit
    // lane and the pace car.
    ['requestParams=["CarIdxLapDistPct","CarLeftRight","IsOnTrack"]', 'requestParams=["CarIdxLapDistPct","CarLeftRight","IsOnTrack","CarIdxOnPitRoad"]'],
    ['carIdx!==driverCarIdx&&-1!==dist&&', 'carIdx!==driverCarIdx&&-1!==dist&&!(ir.CarIdxOnPitRoad&&ir.CarIdxOnPitRoad[carIdx])&&!(ir.DriverInfo&&carIdx===ir.DriverInfo.PaceCarIdx)&&'],
  ],
  'apps/server/racing-overlay/relatives/relatives.js': [
    // the same in Relatives' car left/right line (it already gets CarIdxOnPitRoad)
    ['carIdx!==driverCarIdx&&-1!==dist&&', 'carIdx!==driverCarIdx&&-1!==dist&&!(ir.CarIdxOnPitRoad&&ir.CarIdxOnPitRoad[carIdx])&&!(ir.DriverInfo&&carIdx===ir.DriverInfo.PaceCarIdx)&&'],
  ],
  'apps/server/racing-overlay/mgu/mgu.js': [
    // MGU only showed for a fixed list of hybrid cars; now also for a car once it has reported a battery charge
    // (newer iRacing hybrids, LMU's hybrids), remembered so it doesn't hide when the battery is empty.
    ['(71===carId||', '(checkShow.hybrid===carId||ir.EnergyERSBatteryPct>0&&(checkShow.hybrid=carId,!0)||71===carId||'],
    ['$scope.$watchGroup(["ir.connected","ir.DriverInfo","ir.IsOnTrack"],(function(){return checkShow()}))', '$scope.$watchGroup(["ir.connected","ir.DriverInfo","ir.IsOnTrack","ir.EnergyERSBatteryPct>0"],(function(){return checkShow()}))'],
  ],
  'apps/server/racing-overlay/pit-helper/pit-helper.js': [
    // Pit Helper's bars meant to stop watching outside pit states 1-3, but the test (below 1 and above 3) never held.
    ['1>(ref=scope.pitState)&&ref>3?', '1>(ref=scope.pitState)||ref>3?', 2],
  ],
  'apps/server/racing-overlay/racing-overlay.js': [
    // The overlay page started new 200 ms profile requests on every reconnect without stopping the old ones.
    ['return requestProfile(),requestProfileInterval=setInterval(requestProfile,200)', 'return clearInterval(requestProfileInterval),clearInterval(requestHideWhenInInterval),requestProfile(),requestProfileInterval=setInterval(requestProfile,200)'],
  ],
  'apps/server/racing-overlay/counters/counters.js': [
    // Counters' viewer count crashed, and so stayed at its last number, once the stream went offline.
    ['this.viewersEl.textContent=t.data[0].viewer_count', 'this.viewersEl.textContent=t.data[0]?t.data[0].viewer_count:0'],
  ],
  'apps/server/racing-overlay/workers/lap-position-time-records.js': [
    // Relatives' reference laps: a new lap was checked against the previous car's class record, not its own.
    ['t=n.get(r),o.sessionNum', 't=n.get(o.driver.CarClassID),o.sessionNum'],
  ],
};

function patchKappsFixes(files) {
  for (const [file, fixes] of Object.entries(KAPPS_FIXES)) {
    if (!files[file]) throw new Error(`Expected file not found in archive: ${file}`);
    let src = files[file].toString('utf8');
    for (const [from, to, count = 1] of fixes) src = mustReplaceAll(src, from, to, count, `${file} fix`);
    files[file] = Buffer.from(src, 'utf8');
  }
}

// --- Patch release notifications ----------------------------------------------------------
// A "Patch Updates" checkbox in Kapps > Settings (on by default). While it's on, the main window asks
// GitHub for this repo's latest release at startup (and when the box is ticked); if its tag is newer than
// PATCH_VERSION it shows a banner using Kapps' own "flashes" (the dismissible bar at the top of the
// window, dismissals remembered in localStorage). Banners are keyed per release, so dismissing one
// doesn't hide the next. Bump PATCH_VERSION with each release and tag the release v<PATCH_VERSION>.
const PATCH_VERSION = '1.6.0';
const PATCH_REPO = 'ssg22/kapps-country-flags';

const RELEASE_CHECK_JS = `$scope.communityPatch = $localStorage.communityPatch ??= { checkReleases: true };
$scope.$watch('communityPatch.checkReleases', function (on) {
  // drop banners for releases that weren't dismissed: they're re-added below if still newer
  for (var key in $scope.flashes) if (key.startsWith('patchRelease-') && !$scope.flashes[key]) delete $scope.flashes[key];
  if (!on) return;
  fetch('https://api.github.com/repos/${PATCH_REPO}/releases/latest').then(function (r) { return r.json(); }).then(function (release) {
    var tag = release.tag_name, key = 'patchRelease-' + tag;
    if (!$scope.communityPatch.checkReleases || !/^v[0-9.]+$/.test(tag) || tag.slice(1).localeCompare('${PATCH_VERSION}', undefined, { numeric: true }) <= 0 || $scope.flashes[key]) return;
    $scope.flashes[key] = false;
    $scope.flashesContent[key] = { class: 'info', content: $sce.trustAsHtml('Kapps community patch ' + tag + ' is available (you have v${PATCH_VERSION}). <a href="https://github.com/${PATCH_REPO}/releases/tag/' + tag + '" target="_blank">View the release</a>') };
    $scope.$apply();
  }).catch(function () {});
});
`;

function patchReleaseCheckAppJs(src) {
  return mustReplace(src, ';return ipcRenderer.send("app-ready-to-show")', ';' + RELEASE_CHECK_JS + 'return ipcRenderer.send("app-ready-to-show")', 'app.js release check');
}

function patchAppSettingsHtml(src) {
  return mustReplace(
    src,
    '\t\t\t\t<!-- import settings -->',
    '\t\t\t\t<!-- community patch releases -->\r\n' +
      '\t\t\t\t<div class="form-group">\r\n' +
      '\t\t\t\t\t<label for="inputPatchReleases" class="col-sm-3 control-label">Patch Updates</label>\r\n' +
      '\t\t\t\t\t<div class="col-sm-9">\r\n' +
      '\t\t\t\t\t\t<div class="checkbox">\r\n' +
      '\t\t\t\t\t\t\t<label>\r\n' +
      '\t\t\t\t\t\t\t\t<input ng-model="communityPatch.checkReleases" type="checkbox" id="inputPatchReleases">\r\n' +
      `\t\t\t\t\t\t\t\tNotify me when a new version of the community patch is released on GitHub (installed: v${PATCH_VERSION})\r\n` +
      '\t\t\t\t\t\t\t</label>\r\n' +
      '\t\t\t\t\t\t</div>\r\n' +
      '\t\t\t\t\t</div>\r\n' +
      '\t\t\t\t</div>\r\n' +
      '\t\t\t\t<!-- import settings -->',
    'apps/app/settings.html patch updates checkbox'
  );
}

// --- New widgets: Weather, Pit Brake, Rejoin Helper, Delta Bar, Flags, Damage -------------
// Widgets of our own, added alongside Kapps' (none are replaced). Each one is a single
// racing-overlay/<dir>/index.html built on Kapps' own AngularJS and ir.service (js/common-*.js) like
// the stock widgets, plus a shared community/widget.js + .css and a settings panel template.
// Kapps learns about them through its shared widget registry; of its many copies only the ones in
// app.js (settings page), racing-overlay.js (overlay page) and index.js (layer windows) iterate the
// widget list, so only those three get the new entries.

// Everything a widget page has in common. config = the widget's defaults overridden by its URL,
// which Kapps builds from the settings page (booleans arrive as 1/0, lists comma-separated);
// ?test=1 is added by the overlay layout editor.
const WIDGET_JS = `// iRacing's track surfaces (CarIdxTrackSurface, PlayerTrackSurface) and racing SessionState
var OFF_TRACK = 0, ON_TRACK = 3, RACING = 4;

function kappsWidget(name, defaults, telemetry, modules) {
  var config = angular.copy(defaults);
  new URLSearchParams(location.search).forEach(function (v, k) {
    var d = defaults[k];
    config[k] = typeof d === 'number' ? Number(v) : typeof d === 'boolean' ? v === '1' : Array.isArray(d) ? (v ? v.split(',') : []) : v;
  });
  config.server = config.host || (location.hostname || '127.0.0.1') + ':8182';
  angular.element(function () { angular.bootstrap(document, [name]); });
  return angular.module(name, ['ir.service'].concat(modules))
    .constant('config', config)
    .config(function (iRServiceProvider) { iRServiceProvider.addOptions({ requestParams: telemetry }); })
    // iRService only connects (and sets $rootScope.ir) once something injects it
    .run(function (iRService) {});
}

// Scales the widget with its window: 1em becomes the largest size at which a widthEm x heightEm box fits.
function kappsFit(widthEm, heightEm) {
  var fit = function () { document.documentElement.style.fontSize = Math.min(innerWidth / widthEm, innerHeight / heightEm) + 'px'; };
  addEventListener('resize', fit);
  fit();
}

// The nearest car behind on track (and accepted by accept(driver), if given): its DriverInfo entry and the
// seconds until it reaches us, timed the same way Kapps' Relatives does.
function kappsCarBehind(ir, Relatives, accept) {
  var me = ir.DriverInfo.DriverCarIdx, here = { carIdx: me, dist: ir.CarIdxLapDistPct[me] }, best = null;
  ir.CarIdxLapDistPct.forEach(function (dist, i) {
    var driver = ir.DriversByCarIdx[i];
    if (i === me || dist < 0 || !driver || driver.CarIsPaceCar || ir.CarIdxTrackSurface[i] !== ON_TRACK || (accept && !accept(driver))) return;
    var gap = Relatives.getTimeDiff({ carIdx: i, dist: dist }, here);
    if (gap != null && (best == null || gap < best.gap)) best = { driver: driver, gap: gap };
  });
  return best;
}

// Sizes a pill widget to its window. In the layout editor it cycles through sample states instead of
// reading telemetry and returns true, so the controller can stop there.
function kappsPill($scope, $interval, config, samples) {
  kappsFit(10, 3.8);
  if (!config.test) return false;
  var i = 0;
  var next = function () { var s = samples[i++ % samples.length]; $scope.pill = { color: s[0], word: s[1], info: s[2] }; };
  next();
  $interval(next, 2500);
  return true;
}
`;

const WIDGET_CSS = `@font-face { font-family: Roboto; font-weight: 400; src: url("../../../../fonts/roboto-v20-vietnamese_latin-ext_latin_greek-ext_greek_cyrillic-ext_cyrillic-regular.woff2") format("woff2"); }
@font-face { font-family: Roboto; font-weight: 700; src: url("../../../../fonts/roboto-v20-vietnamese_latin-ext_latin_greek-ext_greek_cyrillic-ext_cyrillic-700.woff2") format("woff2"); }
html, body { margin: 0; height: 100%; overflow: hidden; background: transparent; color: #fff; font-family: Roboto, sans-serif; user-select: none; }
.pill { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); display: flex; flex-direction: column; align-items: center; padding: .2em .9em .3em; border: .12em solid; border-radius: .5em; background: rgba(12, 13, 15, .85); line-height: 1.15; white-space: nowrap; }
.pill b { font-size: 1.6em; letter-spacing: .05em; }
.pill span { font-size: .8em; color: #fff; opacity: .85; }
.pill.blue { color: #6ea8ff; }
.pill.green { color: #3ddc84; }
.pill.amber { color: #ffb020; }
.pill.red { color: #ff5252; }
`;

// Pit Brake and Rejoin Helper are both a single coloured pill (styled in WIDGET_CSS).
const PILL_WIDGET = {
  bounds: { width: 300, height: 110, minWidth: 100, minHeight: 36 },
  html: '<div ng-if="pill" ng-class="pill.color" class="pill"><b ng-bind="pill.word"></b><span ng-bind="pill.info"></span></div>',
};

const FLAG_ICON = 'M5 21V4h11l-2 4 2 4H5';

// Weather rows the user can add, in catalogue order: id -> label and 24x24 stroke icon.
const WEATHER_ITEMS = {
  trackTemp: { label: 'Track Temp', icon: 'M4 20L9 4M20 20L15 4M12 6v2M12 11v2M12 16v2' },
  airTemp: { label: 'Air Temp', icon: 'M14 14.8V5a2 2 0 0 0-4 0v9.8a4 4 0 1 0 4 0z' },
  wind: { label: 'Wind', icon: 'M3 8h10a3 3 0 1 0-3-3M3 12h15a3 3 0 1 1-3 3M3 16h7' },
  humidity: { label: 'Humidity', icon: 'M12 3s-6 7-6 11a6 6 0 0 0 12 0c0-4-6-11-6-11z' },
  skies: { label: 'Sky', icon: 'M7 18h10a4 4 0 0 0 0-8 6 6 0 0 0-11.5 1.5A3.5 3.5 0 0 0 7 18z' },
  precipitation: { label: 'Rain', icon: 'M7 14h10a4 4 0 0 0 0-8 6 6 0 0 0-11.5 1.5A3.5 3.5 0 0 0 7 14zM8 17l-1 3M12 17l-1 3M16 17l-1 3' },
  wetness: { label: 'Track Wetness', icon: 'M3 9c3-3 6 3 9 0s6 3 9 0M3 15c3-3 6 3 9 0s6 3 9 0' },
  declaredWet: { label: 'Declared Wet', icon: FLAG_ICON },
  fog: { label: 'Fog', icon: 'M4 8h16M2 12h20M4 16h16' },
};

// The Delta Bar's reference laps: iRacing's LapDeltaTo<id> variables (LMU only has BestLap).
const DELTA_REFERENCES = [['BestLap', 'Your best lap'], ['SessionBestLap', 'Session best lap'], ['OptimalLap', 'Your optimal lap'], ['SessionOptimalLap', 'Session optimal lap']];

// The Damage widget's drawing, in a 110 x 160 panel: where LMU's 8 dent zones go, in its order (front, front left,
// left, rear left, rear (the wing, which can come off), rear right, right, front right), and the wheels (FL, FR,
// RL, RR)
const DAMAGE_ZONES = [[33, 0, 34, 22], [0, 0, 30, 22], [0, 25, 12, 100], [0, 128, 30, 22], [33, 128, 34, 22], [70, 128, 30, 22], [88, 25, 12, 100], [70, 0, 30, 22]];
const DAMAGE_WHEELS = [[16, 32], [70, 32], [16, 90], [70, 90]];

// The Flags widget's badges the user can add, in catalogue order (like WEATHER_ITEMS).
const FLAG_ITEMS = {
  pit: { label: 'Pit lane timer', icon: 'M7 21V3h6a5 5 0 0 1 0 10H7' },
  limiter: { label: 'Speed limiter', icon: 'M4 18a9 9 0 1 1 16 0M12 14l4-5' },
  lowFuel: { label: 'Low fuel / energy', icon: 'M4 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16M2 21h14M14 10h2a2 2 0 0 1 2 2v4a1.5 1.5 0 0 0 3 0V8l-3-3M6 9h6' },
  start: { label: 'Start lights', icon: 'M8 2h8v20H8zM12 6v.01M12 12v.01M12 18v.01' },
  yellow: { label: 'Yellow flag / caution', icon: FLAG_ICON },
  blue: { label: 'Blue flag', icon: FLAG_ICON },
  traffic: { label: 'Traffic', icon: 'M3 16v-4l2-5h14l2 5v4zM6 16v3M18 16v3M3 12h18' },
  race: { label: 'White / checkered flag', icon: FLAG_ICON },
  penalty: { label: 'Black flag / DSQ', icon: FLAG_ICON },
};

const formGroup = (label, controls) => `<div class="form-group"><label class="col-sm-3 control-label">${label}</label><div class="col-sm-9">${controls}</div></div>`;
const numberSetting = (key, attrs, text) => `<div class="form-inline"><input ng-model="settings.${key}" ng-change="saveSettings()" type="number" class="form-control input-width-2" ${attrs} /> ${text}</div>`;
const description = (text) => `<p class="form-control-static text-muted">${text}</p>`;
const checkbox = (key, text) => `<div class="checkbox"><label><input ng-model="settings.${key}" ng-change="saveSettings()" type="checkbox" /> ${text}</label></div>`;
const radios = (key, options) => options.map(([value, text]) => `<label class="radio-inline"><input ng-model="settings.${key}" ng-change="saveSettings()" type="radio" value="${value}" /> <span>${text}</span></label>`).join('');
// An ordered list of items picked from catalogue (id -> {label, icon}: a 24x24 stroke path), kept in settings[key]:
// each can be moved up and down or removed, and the ones not in it added.
const listEditor = (key, catalogue, addText) => {
  const move = (to) => `settings.${key}.splice(${to}, 0, settings.${key}.splice($index, 1)[0]); saveSettings()`;
  return (
    `<div ng-init='catalogue = ${JSON.stringify(catalogue)}' class="item-list">` +
    `<div ng-repeat="id in settings.${key} track by $index" class="item-row">` +
    '<svg viewBox="0 0 24 24"><path ng-attr-d="{{catalogue[id].icon}}" /></svg><span class="flex-spacer" ng-bind="catalogue[id].label"></span>' +
    `<button ng-disabled="$first" ng-click="${move('$index - 1')}" class="btn btn-default btn-xs"><span class="glyphicon glyphicon-chevron-up"></span></button>` +
    `<button ng-disabled="$last" ng-click="${move('$index + 1')}" class="btn btn-default btn-xs"><span class="glyphicon glyphicon-chevron-down"></span></button>` +
    `<button ng-click="settings.${key}.splice($index, 1); saveSettings()" data-tippy-content="Remove" class="btn btn-default btn-xs"><span class="glyphicon glyphicon-remove"></span></button>` +
    '</div>' +
    `<div ng-if="settings.${key}.length < ${Object.keys(catalogue).length}" class="btn-group dropdown">` +
    `<a class="btn btn-default btn-sm dropdown-toggle" data-toggle="dropdown"><span class="glyphicon glyphicon-plus"></span> ${addText} <span class="caret"></span></a>` +
    `<ul class="dropdown-menu"><li ng-repeat="(id, item) in catalogue" ng-if="settings.${key}.indexOf(id) < 0"><a ng-click="settings.${key}.push(id); saveSettings()" ng-bind="item.label"></a></li></ul>` +
    '</div></div>'
  );
};

const NEW_WIDGETS = [
  {
    id: 'weather',
    dir: 'weather',
    title: 'Weather',
    bounds: { width: 220, height: 160, minWidth: 80, minHeight: 30 },
    position: '{x:Math.max(0,w-230),y:Math.max(0,(h-160)>>1)}',
    defaultSettings: { hostPort: 8182, fps: 10, rows: ['trackTemp', 'airTemp', 'wind', 'humidity', 'wetness'], units: 'auto', bgOpacity: 70 },
    urlKeys: ['host', 'rows', 'units', 'bgOpacity'],
    telemetry: ['DisplayUnits', 'TrackTempCrew', 'AirTemp', 'WindVel', 'WindDir', 'YawNorth', 'RelativeHumidity', 'Skies', 'Precipitation', 'TrackWetness', 'WeatherDeclaredWet', 'FogLevel'],
    css: `.weather { padding: .25em .55em; border-radius: .45em; }
.row { position: relative; display: flex; align-items: center; gap: .45em; height: 1.75em; }
.row + .row { border-top: 1px solid rgba(255, 255, 255, .08); }
.icon { flex: none; width: 1em; height: 1em; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; opacity: .6; }
.label { flex: 1; overflow: hidden; color: rgba(255, 255, 255, .6); font-size: .8em; white-space: nowrap; text-overflow: ellipsis; }
.value { font-weight: 700; white-space: nowrap; }
.arrow { width: .9em; height: .9em; fill: currentColor; transition: transform .3s; }
.bar { position: absolute; left: 1.45em; right: 0; bottom: .2em; height: .14em; border-radius: .07em; background: rgba(255, 255, 255, .12); }
.bar > div { height: 100%; border-radius: inherit; background: #4f9cf0; transition: width .5s; }`,
    html: `<div ng-show="ir.connected" ng-style="{background: bg}" class="weather">
  <div ng-repeat="row in rows" class="row">
    <svg class="icon" viewBox="0 0 24 24"><path ng-attr-d="{{row.icon}}" /></svg>
    <span class="label" ng-bind="row.label"></span>
    <svg ng-if="row.id == 'wind'" ng-style="{transform: 'rotate(' + windAngle + 'deg)'}" class="arrow" viewBox="0 0 24 24"><path d="M12 2l6 9h-4v11h-4V11H6z" /></svg>
    <span class="value" ng-bind="value(row.id)"></span>
    <div ng-if="row.id == 'wetness'" class="bar"><div ng-style="{width: wetness() + '%'}"></div></div>
  </div>
</div>`,
    js: `var ITEMS = ${JSON.stringify(WEATHER_ITEMS)};
var SKIES = ['Clear', 'Partly cloudy', 'Mostly cloudy', 'Overcast'];
var WETNESS = ['-', 'Dry', 'Mostly dry', 'Very lightly wet', 'Lightly wet', 'Moderately wet', 'Very wet', 'Extremely wet'];
var COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
var SAMPLE = { connected: true, TrackTempCrew: 31.6, AirTemp: 22.3, WindVel: 3.4, WindDir: 0.8, YawNorth: 2.1, RelativeHumidity: 0.62, Skies: 1, Precipitation: 0.15, TrackWetness: 4, WeatherDeclaredWet: true, FogLevel: 0.05 };

app.controller('AppCtrl', function ($scope, config) {
  var ir = config.test ? ($scope.ir = SAMPLE) : $scope.ir;
  var degrees = function (rad) { return ((rad * 180 / Math.PI) % 360 + 360) % 360; };
  var metric = function () { return config.units === 'metric' || (config.units === 'auto' && ir.DisplayUnits !== 0); };
  var temp = function (c) { return metric() ? Math.round(c) + '°C' : Math.round(c * 1.8 + 32) + '°F'; };
  var pct = function (f) { return Math.round(f * 100) + '%'; };
  var wind = function (ms) {
    var speed = metric() ? Math.round(ms * 3.6) + ' km/h' : Math.round(ms * 2.237) + ' mph';
    return ir.WindDir == null ? speed : speed + ' ' + COMPASS[Math.round(degrees(ir.WindDir) / 45) % 8];
  };
  // row id -> [telemetry field, formatter]
  var VALUES = {
    trackTemp: ['TrackTempCrew', temp],
    airTemp: ['AirTemp', temp],
    wind: ['WindVel', wind],
    humidity: ['RelativeHumidity', pct],
    skies: ['Skies', function (v) { return SKIES[v]; }],
    precipitation: ['Precipitation', pct],
    wetness: ['TrackWetness', function (v) { return WETNESS[v]; }],
    declaredWet: ['WeatherDeclaredWet', function (v) { return v ? 'Yes' : 'No'; }],
    fog: ['FogLevel', pct],
  };
  $scope.rows = config.rows.filter(function (id) { return ITEMS[id]; }).map(function (id) { return angular.extend({ id: id }, ITEMS[id]); });
  $scope.bg = 'rgba(12, 13, 15, ' + config.bgOpacity / 100 + ')';
  $scope.value = function (id) {
    var v = ir[VALUES[id][0]];
    return v == null ? '-' : VALUES[id][1](v);
  };
  $scope.wetness = function () { return Math.max(0, (ir.TrackWetness - 1) / 6 * 100); };
  // Arrow points where the wind blows, relative to the car's nose (up). WindDir is where it blows
  // from; YawNorth turns the opposite way to compass bearings. The angle is unwrapped so the arrow
  // turns the short way round instead of spinning back through 0.
  $scope.windAngle = 0;
  $scope.$watch(function () { return ir.WindDir == null || ir.YawNorth == null ? null : degrees(ir.WindDir + ir.YawNorth) + 180; }, function (target) {
    if (target != null) $scope.windAngle += ((target - $scope.windAngle) % 360 + 540) % 360 - 180;
  });
  kappsFit(13, $scope.rows.length * 1.75 + 0.5);
});`,
    settings:
      formGroup('Information', listEditor('rows', WEATHER_ITEMS, 'Add information')) +
      formGroup('Units', radios('units', [['auto', 'Auto (iRacing)'], ['metric', 'Metric'], ['imperial', 'Imperial']])) +
      formGroup(
        'Background',
        '<div class="input-group input-range-with-value"><span class="input-group-addon">Opacity</span>' +
          '<input ng-model="settings.bgOpacity" ng-change="saveSettings()" type="range" class="form-control" min="0" max="100" step="5" />' +
          '<span class="input-group-addon"><span ng-bind="settings.bgOpacity"></span>%</span></div>'
      ),
  },
  {
    ...PILL_WIDGET,
    id: 'pitBrake',
    dir: 'pit-brake',
    title: 'Pit Brake',
    position: '{x:Math.max(0,(w-300)>>1),y:h>>2}',
    defaultSettings: { hostPort: 8182, fps: 15, decel: 10, margin: 5 },
    urlKeys: ['host', 'decel', 'margin'],
    telemetry: ['WeekendInfo', 'OnPitRoad', 'PlayerCarInPitStall', 'Speed', 'LapDistPct', 'PitSvFlags', 'PitSvFuel'],
    js: `app.controller('AppCtrl', function ($scope, $interval, config) {
  if (kappsPill($scope, $interval, config, [['blue', 'WAIT', '120 m'], ['red', 'BRAKE', '45 m'], ['amber', 'HOLD', 'Tyres + Fuel 30 L']])) return;
  var ir = $scope.ir, braking = false, served = false;
  // metres from the car to its pit stall along the track; negative once past it
  var stallDistance = function () {
    var stall = ir.DriverInfo && ir.DriverInfo.DriverPitTrkPct, length = ir.WeekendInfo && ir.WeekendInfo.TrackLength;
    if (stall == null || stall < 0 || !length || ir.LapDistPct == null) return null;
    var lap = (stall - ir.LapDistPct + 1) % 1;
    return (lap > 0.5 ? lap - 1 : lap) * parseFloat(length) * 1000; // TrackLength is "x.xx km"
  };
  var services = function () {
    var flags = ir.PitSvFlags || 0, list = [];
    if (flags & 0x0f) list.push('Tyres');
    if (flags & 0x10) list.push('Fuel ' + Math.round(ir.PitSvFuel) + ' L');
    if (flags & 0x40) list.push('Fast repair');
    return list.join(' + ');
  };
  $scope.$watchGroup(['ir.OnPitRoad', 'ir.PlayerCarInPitStall', 'ir.LapDistPct', 'ir.PitSvFlags', 'ir.PitSvFuel'], function () {
    var distance = stallDistance(), brakeAt;
    if (!ir.OnPitRoad) braking = served = false;
    if (ir.PlayerCarInPitStall) served = true;
    if (!ir.OnPitRoad || distance == null || (served && !ir.PlayerCarInPitStall) || (distance < 0 && !ir.PlayerCarInPitStall)) return ($scope.pill = null);
    if (served) return ($scope.pill = { color: 'amber', word: 'HOLD', info: services() });
    brakeAt = ir.Speed * ir.Speed / (2 * config.decel) + config.margin;
    braking = braking || distance <= brakeAt;
    $scope.pill = braking
      ? { color: 'red', word: 'BRAKE', info: Math.round(distance) + ' m' }
      : { color: 'blue', word: 'WAIT', info: Math.round(distance - brakeAt) + ' m' };
  });
});`,
    settings:
      description('Shows <b>WAIT</b> as you drive down the pit lane, <b>BRAKE</b> when it is time to brake for your pit box, and <b>HOLD</b> with the services being done once you are stopped in it.') +
      formGroup('Braking', numberSetting('decel', 'min="3" max="30" step="0.5"', 'm/s² <span class="text-muted">— raise it if BRAKE shows too early, lower it if too late</span>')) +
      formGroup('Margin', numberSetting('margin', 'min="0" max="50" step="1"', 'm <span class="text-muted">— extra distance to start braking earlier</span>')),
  },
  {
    ...PILL_WIDGET,
    id: 'rejoinHelper',
    dir: 'rejoin-helper',
    title: 'Rejoin Helper',
    position: '{x:Math.max(0,(w-300)>>1),y:h>>3}',
    defaultSettings: { hostPort: 8182, fps: 10, clearSec: 5, dangerSec: 2.5, showWhenStopped: true },
    urlKeys: ['host', 'clearSec', 'dangerSec', 'showWhenStopped'],
    telemetry: ['PlayerTrackSurface', 'CarIdxTrackSurface', 'OnPitRoad', 'Speed', 'SessionState'],
    modules: ['ir.relatives'],
    js: `app.controller('AppCtrl', function ($scope, $interval, config, Relatives) {
  if (kappsPill($scope, $interval, config, [['green', 'CLEAR', '7.0 s'], ['amber', 'CAUTION', '3.4 s'], ['red', 'DANGER', '1.2 s']])) return;
  var ir = $scope.ir, moved = false;
  // off track, or (optionally) stopped/spun on track after having been up to speed this stint
  var needsHelp = function () {
    if (ir.OnPitRoad || ir.SessionState !== RACING) moved = false;
    else if (ir.Speed > 15) moved = true;
    return ir.PlayerTrackSurface === OFF_TRACK || (config.showWhenStopped && moved && ir.PlayerTrackSurface === ON_TRACK && ir.Speed < 3);
  };
  $scope.$watch('ir.CarIdxLapDistPct', function () {
    if (!ir.DriverInfo || !ir.CarIdxLapDistPct || !needsHelp()) return ($scope.pill = null);
    var behind = kappsCarBehind(ir, Relatives), gap = behind && behind.gap, info = gap == null || gap >= 99 ? '' : gap.toFixed(1) + ' s';
    $scope.pill = gap == null || gap >= config.clearSec ? { color: 'green', word: 'CLEAR', info: info }
      : gap >= config.dangerSec ? { color: 'amber', word: 'CAUTION', info: info }
      : { color: 'red', word: 'DANGER', info: info };
  });
});`,
    settings:
      description('Appears while you are off track and shows how far behind the nearest car is: green <b>CLEAR</b>, amber <b>CAUTION</b> or red <b>DANGER</b>.') +
      formGroup('Clear', numberSetting('clearSec', 'min="0.5" max="60" step="0.5"', 's or more behind')) +
      formGroup('Danger', numberSetting('dangerSec', 'min="0" max="60" step="0.5"', 's or less behind <span class="text-muted">(caution in between)</span>')) +
      formGroup('Also show', checkbox('showWhenStopped', 'When stopped or spun on track, not only when off track')),
  },
  {
    id: 'deltaBar',
    dir: 'delta-bar',
    title: 'Delta Bar',
    bounds: { width: 320, height: 70, minWidth: 100, minHeight: 24 },
    position: '{x:Math.max(0,(w-320)>>1),y:Math.max(0,(h>>1)+150)}',
    defaultSettings: { hostPort: 8182, fps: 30, reference: 'BestLap', range: 2, decimals: 3, hold: 3, showBar: true },
    urlKeys: ['host', 'reference', 'range', 'decimals', 'hold', 'showBar'],
    telemetry: ['LapCurrentLapTime', ...DELTA_REFERENCES.flatMap(([ref]) => [`LapDeltaTo${ref}`, `LapDeltaTo${ref}_OK`])],
    css: `.delta { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: .3em; }
.track { position: relative; width: 100%; height: .7em; border-radius: .35em; background: rgba(12, 13, 15, .85); overflow: hidden; }
.track > div { position: absolute; top: 0; bottom: 0; }
.track::after { content: ''; position: absolute; left: 50%; top: 0; bottom: 0; width: .12em; margin-left: -.06em; background: rgba(255, 255, 255, .6); }
.value { padding: .05em .5em; border-radius: .35em; background: rgba(12, 13, 15, .85); font-size: 1.4em; font-weight: 700; font-variant-numeric: tabular-nums; }
.value.gain { color: #3ddc84; }
.value.loss { color: #ff5252; }
.track > .gain { background: #3ddc84; }
.track > .loss { background: #ff5252; }`,
    html: `<div ng-if="text" class="delta">
  <div ng-if="showBar" class="track"><div ng-class="state" ng-style="fill"></div></div>
  <div ng-class="state" class="value" ng-bind="text"></div>
</div>`,
    js: `app.controller('AppCtrl', function ($scope, $interval, config) {
  var key = 'LapDeltaTo' + config.reference, ir = $scope.ir, lastLapTime = 0, lastDelta = null, held = null;
  $scope.showBar = config.showBar;
  kappsFit(16, config.showBar ? 3.4 : 2.2);
  // ahead fills the bar right of the centre line in green, behind fills left in red, up to config.range seconds
  var show = function (delta) {
    if (delta == null) return ($scope.text = '');
    var size = Math.min(Math.abs(delta) / config.range, 1) * 50;
    $scope.text = (delta < 0 ? '-' : '+') + Math.min(Math.abs(delta), 99.999).toFixed(config.decimals);
    $scope.state = delta > 0 ? 'loss' : 'gain';
    $scope.fill = { left: (delta > 0 ? 50 - size : 50) + '%', width: size + '%' };
  };
  if (config.test) {
    var t = 0;
    return $interval(function () { show(Math.sin((t += 0.04)) * config.range * 0.8); }, 50);
  }
  $scope.$watchGroup(['ir.' + key, 'ir.LapCurrentLapTime'], function () {
    var lapTime = ir.LapCurrentLapTime, delta = ir.connected && ir[key + '_OK'] !== false ? ir[key] : null;
    // over the line, the lap's final delta stays up for config.hold seconds
    if (lapTime < lastLapTime) held = lastDelta;
    if (!(lapTime < config.hold)) held = null;
    lastLapTime = lapTime;
    lastDelta = delta;
    show(held != null ? held : delta);
  });
});`,
    settings:
      description('How far ahead (green) or behind (red) you are of a reference lap, as you drive it.') +
      `<div ng-if="!isLmu">${formGroup('Compare to', `<select ng-model="settings.reference" ng-change="saveSettings()" class="form-control">${DELTA_REFERENCES.map(([ref, text]) => `<option value="${ref}">${text}</option>`).join('')}</select>`)}</div>` +
      formGroup('Range', numberSetting('range', 'min="0.1" max="10" step="0.1"', 's <span class="text-muted">— the delta that fills half the bar</span>')) +
      formGroup('Decimals', numberSetting('decimals', 'min="1" max="3" step="1"', '')) +
      formGroup('Hold', numberSetting('hold', 'min="0" max="30" step="1"', 's <span class="text-muted">— how long a finished lap\'s delta stays up</span>')) +
      formGroup('Bar', checkbox('showBar', 'Show the bar, not only the time')),
  },
  {
    id: 'flags',
    dir: 'flags',
    title: 'Flags',
    bounds: { width: 900, height: 44, minWidth: 100, minHeight: 20 },
    position: '{x:Math.max(0,(w-900)>>1),y:60}',
    defaultSettings: { hostPort: 8182, fps: 10, items: Object.keys(FLAG_ITEMS), layout: 'horizontal', lowFuelLaps: 2, trafficGap: 5 },
    urlKeys: ['host', 'items', 'layout', 'lowFuelLaps', 'trafficGap'],
    telemetry: ['SessionFlags', 'SessionState', 'OnPitRoad', 'PitsOpen', 'IsInGarage', 'EngineWarnings', 'Speed', 'DisplayUnits', 'FuelLevel', 'LmuVirtualEnergy', 'LapCompleted', 'PlayerTrackSurface', 'CarIdxTrackSurface'],
    modules: ['ir.relatives'],
    css: `.flags { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; gap: .3em; }
.flags.vertical { flex-direction: column; }
.badge { width: 7em; padding: .2em .5em; border-radius: .35em; font-weight: 700; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: #000; }
.badge.green { background: #3ddc84; }
.badge.grey { background: #ddd; }
.badge.red { background: #ff5252; }
.badge.orange { background: #ffb020; }
.badge.yellow { background: #ffe14d; }
.badge.blue { background: #4fa3ff; }
.badge.traffic { background: #4f5bff; color: #fff; }
.badge.white { background: #fff; }
.badge.black { background: #111; color: #fff; box-shadow: inset 0 0 0 .1em #fff; }`,
    html: `<div ng-class="layout" class="flags"><div ng-repeat="b in badges track by $index" ng-class="b[0]" class="badge" ng-bind="b[1]"></div></div>`,
    js: `// iRacing's SessionFlags bits (the LMU bridge sets the same ones)
var FLAG = { checkered: 0x1, white: 0x2, yellow: 0x8, blue: 0x20, yellowWaving: 0x100, caution: 0x4000, cautionWaving: 0x8000, black: 0x10000, disqualify: 0x20000, repair: 0x100000, startReady: 0x20000000, startSet: 0x40000000, startGo: 0x80000000 };
var LIMITER = 0x10;
// badge id -> [colour, text] as shown in the layout editor
var SAMPLES = { pit: ['green', 'PIT 12.4'], limiter: ['red', 'LIMIT 80'], lowFuel: ['orange', 'FUEL 1.6 laps'], start: ['red', 'READY'], yellow: ['yellow', 'YELLOW'], blue: ['blue', 'BLUE 3s'], traffic: ['traffic', 'HYPER 2.4s'], race: ['white', 'LAST LAP'], penalty: ['black', 'BLACK FLAG'] };

// Tracks an amount (fuel, virtual energy) lap by lap and returns the average used per lap over the last 3 whole
// laps, or null; a lap it gained over (refuelling) or only saw part of doesn't count.
function usagePerLap() {
  var start = null, used = [];
  return function (lap, amount) {
    if (amount == null || lap == null) return null;
    if (start && lap !== start.lap) {
      if (!start.partial && lap === start.lap + 1 && amount < start.amount) used = used.concat(start.amount - amount).slice(-3);
      start = { lap: lap, amount: amount };
    }
    start = start || { lap: lap, amount: amount, partial: true };
    return used.length ? used.reduce(function (a, b) { return a + b; }) / used.length : null;
  };
}

app.controller('AppCtrl', function ($scope, config, Relatives) {
  var items = config.items.filter(function (id) { return SAMPLES[id]; }), n = Math.max(items.length, 1);
  $scope.layout = config.layout;
  // badges are 8em wide and 1.55em tall, .3em apart
  kappsFit(config.layout === 'vertical' ? 8.3 : n * 8.3, config.layout === 'vertical' ? n * 1.85 : 1.85);
  if (config.test) return ($scope.badges = items.map(function (id) { return SAMPLES[id]; }));
  var ir = $scope.ir, last = 0;
  var fuel, energy, pitIn, pitOut, greenUntil, wasReady, blueSince, rejoinUntil, onPitRoad, moved;
  var reset = function () {
    fuel = usagePerLap();
    energy = usagePerLap();
    pitIn = pitOut = blueSince = null;
    greenUntil = rejoinUntil = 0;
    wasReady = onPitRoad = moved = false;
  };
  // each returns its badge, or nothing; all run every update, as some keep state
  var BADGES = {
    pit: function (now) {
      if (ir.IsInGarage) return (pitIn = pitOut = null);
      if (ir.OnPitRoad) {
        pitIn = pitIn == null ? now : pitIn;
        return ir.PitsOpen === false ? ['red', 'PIT CLOSED'] : ['green', 'PIT ' + (now - pitIn).toFixed(1)];
      }
      if (pitIn != null) pitOut = { at: now, time: now - pitIn };
      pitIn = null;
      // the time spent in the pit lane stays up for 10 s after leaving it
      if (pitOut && now - pitOut.at < 10) return ['grey', 'PIT ' + pitOut.time.toFixed(1)];
    },
    limiter: function () {
      if (ir.EngineWarnings & LIMITER) return ['red', 'LIMIT ' + Math.round(ir.Speed * (ir.DisplayUnits === 0 ? 2.237 : 3.6))];
    },
    lowFuel: function () {
      var perLap = fuel(ir.LapCompleted, ir.FuelLevel), vePerLap = energy(ir.LapCompleted, ir.LmuVirtualEnergy);
      var laps = perLap ? ir.FuelLevel / perLap : Infinity, veLaps = vePerLap ? ir.LmuVirtualEnergy / vePerLap : Infinity;
      // whichever runs out first: fuel, or LMU's virtual energy
      var left = Math.min(laps, veLaps);
      if (left < config.lowFuelLaps) return ['orange', (veLaps < laps ? 'VE ' : 'FUEL ') + left.toFixed(1) + ' laps'];
    },
    start: function (now, flags) {
      var ready = !!(flags & (FLAG.startReady | FLAG.startSet));
      if ((wasReady && !ready) || flags & FLAG.startGo) greenUntil = now + 3;
      wasReady = ready;
      if (ready) return ['red', 'READY'];
      if (now < greenUntil) return ['green', 'GREEN'];
    },
    yellow: function (now, flags) {
      if (flags & (FLAG.caution | FLAG.cautionWaving)) return ['yellow', 'CAUTION'];
      if (flags & (FLAG.yellow | FLAG.yellowWaving)) return ['yellow', 'YELLOW'];
    },
    blue: function (now, flags) {
      if (!(flags & FLAG.blue)) return (blueSince = null);
      blueSince = blueSince == null ? now : blueSince;
      return ['blue', 'BLUE ' + Math.round(now - blueSince) + 's'];
    },
    // a car closing in behind while racing: from a faster class any time, or any car while you rejoin (for 10 s
    // after leaving the pit lane, or after being slow or off track once up to speed, as Rejoin Helper)
    traffic: function (now) {
      var me = ir.DriverInfo && ir.DriversByCarIdx && ir.DriversByCarIdx[ir.DriverInfo.DriverCarIdx], left = onPitRoad && !ir.OnPitRoad;
      onPitRoad = ir.OnPitRoad;
      if (ir.SessionState !== RACING) moved = false;
      else if (ir.Speed > 15) moved = true;
      if (!me || !ir.CarIdxLapDistPct || ir.OnPitRoad || ir.SessionState !== RACING) return;
      if (left || (moved && (ir.Speed < 8 || ir.PlayerTrackSurface === OFF_TRACK))) rejoinUntil = now + 10;
      var rejoining = now < rejoinUntil;
      var behind = kappsCarBehind(ir, Relatives, rejoining ? null : function (driver) { return driver.CarClassEstLapTime < me.CarClassEstLapTime; });
      if (behind && behind.gap <= config.trafficGap) return ['traffic', (rejoining ? 'TRAFFIC' : behind.driver.CarClassShortName || 'TRAFFIC') + ' ' + behind.gap.toFixed(1) + 's'];
    },
    race: function (now, flags) {
      if (flags & FLAG.checkered) return ['white', 'FINISH'];
      if (flags & FLAG.white) return ['white', 'LAST LAP'];
    },
    penalty: function (now, flags) {
      if (flags & FLAG.disqualify) return ['black', 'DSQ'];
      if (flags & FLAG.black) return ['black', 'BLACK FLAG'];
      if (flags & FLAG.repair) return ['orange', 'REPAIR'];
    },
  };
  reset();
  $scope.$watch('ir.SessionTime', function (now) {
    if (now == null || !ir.connected) return ($scope.badges = []);
    if (now < last) reset(); // a new session
    last = now;
    $scope.badges = items.map(function (id) { return BADGES[id](now, ir.SessionFlags || 0); }).filter(Boolean);
  });
});`,
    settings:
      description('Shows a badge for each of these while it applies: the pit lane timer, speed limiter, low fuel, start lights, flags, and <b>TRAFFIC</b> with the gap to a faster car closing in behind.') +
      formGroup('Badges', listEditor('items', FLAG_ITEMS, 'Add badge')) +
      formGroup('Layout', radios('layout', [['horizontal', 'Side by side'], ['vertical', 'Stacked']])) +
      formGroup('Low fuel', numberSetting('lowFuelLaps', 'min="0.5" max="10" step="0.5"', 'laps or fewer left')) +
      formGroup('Traffic', numberSetting('trafficGap', 'min="1" max="30" step="0.5"', 's or closer <span class="text-muted">— faster classes always, any car while you rejoin from the pits or off track</span>')),
  },
  {
    // LMU only (LMU_ONLY_WIDGETS): the car from above, its 8 body zones around it coloured by damage, the wheels
    // inside, percent damaged in the middle, and a cone towards the last impact for a few seconds
    id: 'damage',
    dir: 'damage',
    title: 'Damage',
    bounds: { width: 120, height: 180, minWidth: 40, minHeight: 60 },
    position: '{x:Math.max(0,w-140),y:Math.max(0,(h>>1)+100)}',
    defaultSettings: { hostPort: 8182, fps: 10, impactSec: 5 },
    urlKeys: ['host', 'impactSec'],
    telemetry: ['SessionTime', 'LmuDents', 'LmuDetached', 'LmuWheelsDetached', 'LmuWheelsFlat', 'LmuDamage', 'LmuImpactTime', 'LmuImpactAngle'],
    css: `svg { position: absolute; inset: 0; width: 100%; height: 100%; }
.zone { fill: #4a515c; }
.zone.z1 { fill: #ffb020; }
.zone.z2 { fill: #ff5252; }
.zone.z3, .wheel.off { fill: #ff5252; animation: flash 1s step-end infinite; }
.wheel { fill: #8a93a0; }
.wheel.flat { fill: none; stroke: #ff5252; stroke-width: 3; }
.impact { fill: rgba(255, 82, 82, .45); }
text { fill: #fff; font-size: 15px; font-weight: 700; text-anchor: middle; dominant-baseline: central; }
@keyframes flash { 50% { fill: #b04dff; } }`,
    // the cone is clipped to the panel by a group around it, as a clip on the cone itself would turn with it
    html: `<svg ng-if="ir.connected && ir.LmuDents" viewBox="-5 -5 110 160">
  <defs><rect id="panel" x="-5" y="-5" width="110" height="160" rx="9" /><clipPath id="panel-clip"><use href="#panel" /></clipPath></defs>
  <use href="#panel" fill="rgba(12, 13, 15, .85)" />
${DAMAGE_ZONES.map(([x, y, w, h], i) => `  <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="3" ng-attr-class="zone z{{ zone(${i}) }}" />`).join('\n')}
${DAMAGE_WHEELS.map(([x, y], i) => `  <rect x="${x}" y="${y}" width="14" height="28" rx="3" ng-attr-class="wheel {{ wheel(${i}) }}" />`).join('\n')}
  <g clip-path="url(#panel-clip)"><path ng-if="impact()" ng-attr-transform="rotate({{ ir.LmuImpactAngle }} 50 75)" d="M50 75 L28 -30 L72 -30 Z" class="impact" /></g>
  <text x="50" y="75" ng-bind="ir.LmuDamage + '%'"></text>
</svg>`,
    js: `var SAMPLE = { connected: true, SessionTime: 10, LmuDents: [0, 1, 2, 0, 0, 0, 1, 0], LmuDetached: false, LmuWheelsDetached: [false, false, false, false], LmuWheelsFlat: [false, true, false, false], LmuDamage: 25, LmuImpactTime: 9, LmuImpactAngle: -50 };

app.controller('AppCtrl', function ($scope, config) {
  var ir = config.test ? ($scope.ir = SAMPLE) : $scope.ir;
  // 0-2 by dent severity, 3 when the rear wing (zone 4) is off
  $scope.zone = function (i) { return i === 4 && ir.LmuDetached ? 3 : ir.LmuDents[i]; };
  $scope.wheel = function (i) { return ir.LmuWheelsDetached[i] ? 'off' : ir.LmuWheelsFlat[i] ? 'flat' : ''; };
  // not before the impact either: its time can outlive a session's restarting clock
  $scope.impact = function () {
    var since = ir.SessionTime - ir.LmuImpactTime;
    return ir.LmuImpactTime > 0 && since >= 0 && since < config.impactSec;
  };
});`,
    settings:
      description('Your car from above: its 8 body zones in amber or red as they get damaged (flashing if the rear wing comes off), the wheels (outlined in red when flat, flashing when off), percent damaged in the middle, and a red cone towards the last impact.') +
      formGroup('Impact', numberSetting('impactSec', 'min="0" max="30" step="1"', 's <span class="text-muted">— how long the cone towards the last impact shows</span>')),
  },
];

const settingsVar = (w) => 'settings' + w.id[0].toUpperCase() + w.id.slice(1);

const widgetPage = (w) => `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>${w.title}</title>
<link rel="stylesheet" type="text/css" href="../community/widget.css" />
${w.css ? `<style>
${w.css}
</style>
` : ''}<script src="../../../../js/common-main.js"></script>
<script src="../../../../js/common-ir.js"></script>
<script src="../community/widget.js"></script>
</head>
<body ng-controller="AppCtrl">
${w.html}
<script>
var app = kappsWidget(${JSON.stringify(w.id)}, ${JSON.stringify(w.defaultSettings)}, ${JSON.stringify(w.telemetry)}, ${JSON.stringify(w.modules || [])});
${w.js}
</script>
</body>
</html>
`;

const settingsPanel = (w) => `<div class="panel panel-default">
<div ng-class="{'off': !enabled}" class="panel-heading">
<h3 class="panel-title">
<label class="checkbox-inline"><input ng-model="enabled" ng-change="saveSettings()" type="checkbox" /> ${w.title}</label>
<div ng-if="enabled" class="toolbar"><button ng-click="openLayerWindow('${w.id}')" data-tippy-content="Open layer in a window"><span class="glyphicon glyphicon-th-large"></span></button></div>
</h3>
</div>
<div ng-if="enabled" class="panel-body">
${w.settings}
</div>
</div>
`;

// app.js, racing-overlay.js and index.js: registry entries, plus default screen positions by
// wrapping the stock getDefaultScreenPosition (a switch over Kapps' own ids).
function patchNewWidgetsRegistry(src, label) {
  const entries = NEW_WIDGETS.map(({ id, title, bounds, defaultSettings, urlKeys }) => JSON.stringify({ id, title, testable: true, bounds, defaultSettings, urlKeys }) + ',').join('');
  src = mustReplace(src, '{id:"counters",title:"Counters",', entries + '{id:"counters",title:"Counters",', label + ' new widgets registry');
  const positions = '{' + NEW_WIDGETS.map((w) => `${w.id}:function(w,h){return${w.position}}`).join(',') + '}';
  return mustReplace(
    src,
    'getDefaultScreenPosition:function(',
    `getDefaultScreenPosition:function(id,w,h){var p=${positions}[id];return p?p(w,h):this.kappsDefaultScreenPosition(id,w,h)},kappsDefaultScreenPosition:function(`,
    label + ' new widgets default positions'
  );
}

// app.js: off by default, each profile gets the widget's settings object (filled with defaults like
// the stock widgets'), and its overlay URL is rebuilt with the others.
function patchNewWidgetsAppJs(src) {
  const list = JSON.stringify(NEW_WIDGETS.map((w) => ({ id: w.id, dir: w.dir, settings: settingsVar(w) })));
  src = mustReplace(src, 'followers:!1,counters:!1', 'followers:!1,counters:!1' + NEW_WIDGETS.map((w) => `,${w.id}:!1`).join(''), 'app.js new widgets off by default');
  src = mustReplace(
    src,
    'k in settingsCounters||(settingsCounters[k]=v);',
    `k in settingsCounters||(settingsCounters[k]=v);${list}.forEach(function(w){var s=$scope[w.settings]=currentProfile[w.settings]=currentProfile[w.settings]||{},d=overlaysData.getById(w.id).defaultSettings;for(var k in d)k in s||(s[k]=angular.copy(d[k]))});`,
    'app.js new widgets profile settings'
  );
  return mustReplace(
    src,
    ',delete settingsMain.customOverlaysJSON',
    `,${list}.forEach(function(w){var od=overlaysData.getById(w.id);settingsMain[w.id+"URL"]=w.dir+"/index.html"+createURLParams(od.urlKeys,$scope[w.settings],od.defaultSettings)}),delete settingsMain.customOverlaysJSON`,
    'app.js new widgets URLs'
  );
}

function patchNewWidgetsOverlayHtml(src) {
  const slot = '<div app-widget="counters" class="widget"></div>';
  return mustReplace(src, slot, slot + NEW_WIDGETS.map((w) => `\r\n\t\t\t<div app-widget="${w.id}" class="widget"></div>`).join(''), 'racing-overlay.html new widget slots');
}

// Adds a file that doesn't exist in stock Kapps; writeAsar fills in its size and offset.
function addAsarFile(header, files, relPath, content) {
  let node = header;
  for (const dir of path.posix.dirname(relPath).split('/')) node = node.files[dir] ??= { files: {} };
  node.files[path.posix.basename(relPath)] = {};
  files[relPath] = Buffer.from(content, 'utf8');
}

function addNewWidgetFiles(header, files, overlayBase) {
  addAsarFile(header, files, overlayBase + 'community/widget.js', WIDGET_JS);
  addAsarFile(header, files, overlayBase + 'community/widget.css', WIDGET_CSS);
  for (const w of NEW_WIDGETS) {
    addAsarFile(header, files, `${overlayBase}${w.dir}/index.html`, widgetPage(w));
    addAsarFile(header, files, `${overlayBase}settings/${w.dir}.html`, settingsPanel(w));
  }
}

function main() {
  const asarPath = findAsar();
  console.log('Target app.asar:', asarPath);
  if (!fs.existsSync(asarPath)) throw new Error(`File not found: ${asarPath}`);

  const backupPath = asarPath + '.original-backup';
  if (!fs.existsSync(backupPath)) {
    fs.copyFileSync(asarPath, backupPath);
    console.log('Backed up original to', backupPath);
  } else {
    console.log('Backup already exists at', backupPath, '(leaving it alone)');
  }

  const { header, files } = readAsar(asarPath);

  const overlayBase = 'apps/server/racing-overlay/';
  const paths = {
    worker: overlayBase + 'standings2/worker/worker.js',
    standingsJs: overlayBase + 'standings2/standings.js',
    indexHtml: overlayBase + 'standings2/index.html',
    standingsCss: overlayBase + 'standings2/standings.css',
    settingsJs: overlayBase + 'standings2/settings/settings.js',
    settingsCss: overlayBase + 'standings2/settings/settings.css',
    standingsSettingsHtml: overlayBase + 'standings2/settings/settings.html',
    racingOverlay: overlayBase + 'racing-overlay.js',
    mainProcess: 'index.js',
    appJs: 'app.js',
    fuelCalcJs: 'apps/server/fuel-calc/fuel-calc.js',
    relativesJs: overlayBase + 'relatives/relatives.js',
    relativesIndexHtml: overlayBase + 'relatives/index.html',
    relativesCss: overlayBase + 'relatives/relatives.css',
    relativesSettingsHtml: overlayBase + 'settings/relatives.html',
    fuelCalcHtml: 'apps/server/fuel-calc/fuel-calc.html',
    fuelCalcCss: 'apps/server/fuel-calc/fuel-calc.css',
    fuelCalcSettingsHtml: 'apps/server/fuel-calc/settings.html',
    racingOverlayFuelCalcSettingsHtml: overlayBase + 'settings/fuel-calc.html',
    appIndexHtml: 'index.html',
    appCss: 'css/app.css',
    racingOverlaySettingsHtml: overlayBase + 'settings/settings.html',
    racingOverlayHtml: overlayBase + 'racing-overlay.html',
    appSettingsHtml: 'apps/app/settings.html',
    appsListHtml: 'apps/apps.html',
    standingsLegacySettingsHtml: overlayBase + 'settings/standings.html',
    standingsLegacyJs: overlayBase + 'standings/standings.js',
    standingsLegacyCss: overlayBase + 'standings/standings.css',
  };
  // Other overlay bundles that each carry their own copy of the shared widget-registry
  // module (defaultSettings/urlKeys for every widget, including driver.columns) — these
  // just need that shared module kept consistent, nothing widget-specific.
  const otherWidgetPaths = [
    overlayBase + 'tyres/tyres.js',
    paths.standingsLegacyJs,
    overlayBase + 'pit-helper/pit-helper.js',
    overlayBase + 'pedals/pedals.js',
    overlayBase + 'mgu/mgu.js',
    overlayBase + 'inputs-graph/inputs-graph.js',
    overlayBase + 'followers/followers.js',
    overlayBase + 'counters/counters.js',
    overlayBase + 'car-left-right/car-left-right.js',
  ];

  for (const p of [...Object.values(paths), ...otherWidgetPaths]) {
    if (!files[p]) throw new Error(`Expected file not found in archive: ${p}`);
  }

  // worker.js and standings.js were previously missing the Relatives-feature's shared
  // showCountryFlag defaultSettings/urlKeys entries (patchRelativesSharedSettings was never
  // chained into either) — a pre-existing gap independent of today's Fastest Lap/target-laps
  // work, fixed here alongside it.
  files[paths.worker] = Buffer.from(
    patchAvg5SharedSettings(
      patchTargetLapsSharedSettings(
        patchRelativesSharedSettings(patchWorkerLmuColumns(patchWorkerFastestLap(patchStandingsWorkerHost(patchWorker(files[paths.worker].toString('utf8'))))), 'worker.js'),
        'worker.js'
      ),
      'worker.js'
    ),
    'utf8'
  );
  files[paths.standingsJs] = Buffer.from(
    patchAvg5SharedSettings(
      patchTargetLapsSharedSettings(
        patchRelativesSharedSettings(patchStandingsJsColumnTitles(patchStandingsJsLmuColumns(patchStandingsMissingRatings(patchStandingsJsFastestLap(patchStandingsJs(files[paths.standingsJs].toString('utf8')))))), 'standings.js'),
        'standings.js'
      ),
      'standings.js'
    ),
    'utf8'
  );
  files[paths.indexHtml] = Buffer.from(patchIndexHtmlLmuColumns(patchIndexHtmlFastestLap(patchIndexHtml(files[paths.indexHtml].toString('utf8')))), 'utf8');
  files[paths.standingsCss] = Buffer.from(patchStandingsCssColumnTitles(patchStandingsCssLmuColumns(patchStandingsCssFastestLap(patchStandingsCss(files[paths.standingsCss].toString('utf8'))))), 'utf8');
  // settings.js also carries the same dead-weight shared-registry duplication (it doesn't use
  // driver.columns/showCountryFlag for anything itself, but the webpack bundle embeds a copy
  // regardless) — was never getting patchDefaultColumns/patchRelativesSharedSettings either.
  files[paths.settingsJs] = Buffer.from(
    patchAvg5SharedSettings(
      patchTargetLapsSharedSettings(
        patchRelativesSharedSettings(patchDefaultColumns(patchStandingsSizing(patchSettingsJsLmuColumns(patchSettingsJsFastestLap(patchSettingsJs(files[paths.settingsJs].toString('utf8')))), 'settings.js'), 'settings.js'), 'settings.js'),
        'settings.js'
      ),
      'settings.js'
    ),
    'utf8'
  );
  files[paths.standingsSettingsHtml] = Buffer.from(patchStandingsSettingsHtmlColumnTitles(files[paths.standingsSettingsHtml].toString('utf8')), 'utf8');
  files[paths.settingsCss] = Buffer.from(patchSettingsCssLmuColumns(patchSettingsCssFastestLap(patchSettingsCss(files[paths.settingsCss].toString('utf8')))), 'utf8');
  files[paths.racingOverlay] = Buffer.from(
    patchNewWidgetsRegistry(
      patchAvg5SharedSettings(
        patchTargetLapsSharedSettings(patchDefaultColumns(patchRelativesSharedSettings(patchStandingsSizing(files[paths.racingOverlay].toString('utf8'), 'racing-overlay.js'), 'racing-overlay.js'), 'racing-overlay.js'), 'racing-overlay.js'),
        'racing-overlay.js'
      ),
      'racing-overlay.js'
    ),
    'utf8'
  );
  files[paths.mainProcess] = Buffer.from(
    patchNewWidgetsRegistry(
      patchAvg5SharedSettings(
        patchTargetLapsSharedSettings(patchRelativesSharedSettings(patchStandingsSizing(patchDefaultColumns(files[paths.mainProcess].toString('utf8'), 'index.js'), 'index.js'), 'index.js'), 'index.js'),
        'index.js'
      ),
      'index.js'
    ),
    'utf8'
  );
  files[paths.appJs] = Buffer.from(
    patchLmuAppJs(
      patchReleaseCheckAppJs(
        patchNewWidgetsAppJs(
          patchNewWidgetsRegistry(
            patchAvg5SharedSettings(
              patchTargetLapsSharedSettings(patchRelativesSharedSettings(files[paths.appJs].toString('utf8'), 'app.js'), 'app.js'),
              'app.js'
            ),
            'app.js'
          )
        )
      )
    ),
    'utf8'
  );
  files[paths.fuelCalcJs] = Buffer.from(
    patchFuelCalcJsLmuEnergy(patchFuelCalcJs(
      patchAvg5SharedSettings(
        patchTargetLapsSharedSettings(patchRelativesSharedSettings(files[paths.fuelCalcJs].toString('utf8'), 'fuel-calc.js'), 'fuel-calc.js'),
        'fuel-calc.js'
      )
    )),
    'utf8'
  );
  files[paths.relativesJs] = Buffer.from(
    patchAvg5SharedSettings(
      patchTargetLapsSharedSettings(skipMissingLicense(patchRelativesJs(files[paths.relativesJs].toString('utf8')), 'config.showSRiRBadges&&!d.CarIsPaceCar', 'relatives.js'), 'relatives.js'),
      'relatives.js'
    ),
    'utf8'
  );
  files[paths.relativesIndexHtml] = Buffer.from(patchRelativesIndexHtml(files[paths.relativesIndexHtml].toString('utf8')), 'utf8');
  files[paths.relativesCss] = Buffer.from(patchRelativesCss(files[paths.relativesCss].toString('utf8')), 'utf8');
  files[paths.relativesSettingsHtml] = Buffer.from(
    hideOptionsOnLmu(patchRelativesSettingsHtml(files[paths.relativesSettingsHtml].toString('utf8')), ['sof', 'incidents', 'humidity', 'ratingGain'], 'settings/relatives.html'),
    'utf8'
  );
  files[paths.fuelCalcHtml] = Buffer.from(patchFuelCalcHtmlLmuEnergy(patchFuelCalcHtml(files[paths.fuelCalcHtml].toString('utf8'))), 'utf8');
  files[paths.fuelCalcCss] = Buffer.from(patchFuelCalcCss(files[paths.fuelCalcCss].toString('utf8')), 'utf8');
  files[paths.fuelCalcSettingsHtml] = Buffer.from(patchFuelCalcSettingsHtml(files[paths.fuelCalcSettingsHtml].toString('utf8')), 'utf8');
  files[paths.racingOverlayFuelCalcSettingsHtml] = Buffer.from(
    hideOptionsOnLmu(patchRacingOverlayFuelCalcSettingsHtml(files[paths.racingOverlayFuelCalcSettingsHtml].toString('utf8')), ['sof', 'incidents', 'humidity'], 'settings/fuel-calc.html'),
    'utf8'
  );
  files[paths.appIndexHtml] = Buffer.from(patchAppIndexHtml(files[paths.appIndexHtml].toString('utf8')), 'utf8');
  files[paths.appCss] = Buffer.from(patchAppCss(files[paths.appCss].toString('utf8')), 'utf8');
  files[paths.racingOverlaySettingsHtml] = Buffer.from(patchRacingOverlaySettingsHtml(files[paths.racingOverlaySettingsHtml].toString('utf8')), 'utf8');
  files[paths.racingOverlayHtml] = Buffer.from(patchNewWidgetsOverlayHtml(files[paths.racingOverlayHtml].toString('utf8')), 'utf8');
  files[paths.appSettingsHtml] = Buffer.from(patchAppSettingsHtml(files[paths.appSettingsHtml].toString('utf8')), 'utf8');
  files[paths.appsListHtml] = Buffer.from(patchAppsListHtml(files[paths.appsListHtml].toString('utf8')), 'utf8');
  files[paths.standingsLegacySettingsHtml] = Buffer.from(hideOptionsOnLmu(files[paths.standingsLegacySettingsHtml].toString('utf8'), ['ratingGain'], 'settings/standings.html'), 'utf8');
  addNewWidgetFiles(header, files, overlayBase);
  addAsarFile(header, files, 'apps/lmu/sidebar.html', LMU_SIDEBAR_HTML);
  addAsarFile(header, files, 'apps/lmu/about.html', LMU_ABOUT_HTML);

  for (const p of otherWidgetPaths) {
    let content = files[p].toString('utf8');
    content = patchDefaultColumns(content, p);
    content = patchRelativesSharedSettings(content, p);
    content = patchTargetLapsSharedSettings(content, p);
    content = patchAvg5SharedSettings(content, p);
    files[p] = Buffer.from(content, 'utf8');
  }
  files[paths.standingsLegacyJs] = Buffer.from(skipMissingLicense(files[paths.standingsLegacyJs].toString('utf8'), 'if(config.showSRiRBadges', 'standings/standings.js'), 'utf8');

  // full-colour car logos: the widgets that show car makes, Standings' worker, and the setting
  for (const [js, css] of [[paths.standingsJs, paths.standingsCss], [paths.relativesJs, paths.relativesCss], [paths.standingsLegacyJs, paths.standingsLegacyCss]]) {
    files[js] = Buffer.from(COLOUR_LOGOS_JS + patchCarMakes(files[js].toString('utf8'), js), 'utf8');
    files[css] = Buffer.from(patchColourLogosCss(files[css].toString('utf8'), css, css === paths.standingsCss), 'utf8');
  }
  files[paths.worker] = Buffer.from(patchCarMakes(files[paths.worker].toString('utf8'), paths.worker), 'utf8');
  files[paths.appJs] = Buffer.from(patchColourLogosAppJs(files[paths.appJs].toString('utf8')), 'utf8');
  files[paths.settingsJs] = Buffer.from(patchColourLogosEditorJs(files[paths.settingsJs].toString('utf8')), 'utf8');
  files[paths.racingOverlaySettingsHtml] = Buffer.from(patchColourLogosSettingsHtml(files[paths.racingOverlaySettingsHtml].toString('utf8')), 'utf8');

  patchKappsFixes(files);

  installLmuBridge(asarPath);
  const tmpPath = asarPath + '.new';
  writeAsar(header, files, tmpPath);
  fs.renameSync(tmpPath, asarPath);
  console.log('Patched successfully! Fully quit and relaunch Kapps for the change to take effect.');
}

try {
  main();
} catch (err) {
  console.error('PATCH FAILED:', err.message);
  process.exitCode = 1;
}
