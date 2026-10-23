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
  src = mustReplace(
    src,
    'fuels.length&&((f=fuels.slice()).length>=3&&(f=f.sort().slice(1,-1)),total=f.reduce((function(a,b){return a+b})),scope.usageAvg=total/f.length)',
    'fuels.length&&(scope.usageAvg5=fuels.reduce((function(a,b){return a+b}),0)/fuels.length,(f=fuels.slice()).length>=3&&(f=f.sort().slice(1,-1)),total=f.reduce((function(a,b){return a+b})),scope.usageAvg=total/f.length)',
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
const LMU_ICON = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAD8AAAAgCAYAAACl36CRAAAKyklEQVRogbWZW4xf1XXGf986Z8Ye202mxuCAQX1oRZW0BCJCuAR8LUkgapU8VYrUPDVPlaqqUqW2D1VfKvWtUt6qXlT1paqQ+pAKUFxsbGMbCHExqUlUlVYkUN9wweDrzP/s/fVh733+/xkbPMTJto80nrP3Putb128tizWsybbdu3vpnmz6IHv6Rhl18wzDyzr9/EGDBJ49237n27d/mpj7OuQrGUdER17Lx29iRS6yZkIhJiQf16n9h9r7/qMOe/G+RTbd8veIr1EuAEV9WTFGT8qT3wUOAgGk61428Xmv9x8p5hfDBXZIN4fuRqsrskYzR+fsbXueOrd09Vtbzh25eF3wo7U2bv4bdfNfJy0NOIEkDMbIGEkelq4sX720tx69xpgqagqde+GUt+34fdz9I87L2IF+3uhnQdkI0a/77S32BcG3rvn4CPyW7Z9moX8dlIqgCJUNBmQlIjo7vRJv73/wht8GAeFtu19RdPeRUzJ0Ck296Oe1qtzFajJ4mcnyr8d1tgZAXt/vJHrARlazer0KZCOh7IMVXHcjEQRJHv4YLFR+gataJI0PM/+enr72neq1q/exap/bzxZYoAWiv/t64F004F1Tvam6jWQJjVuslPPzs+c+FDlkQ+jkob3k9Azqe0yyDV7l/pLsYqopaI8yTCWVkF0U2IDayPWOmfum4smwPBnymWvAFyE/u9HwMM6i+Anto7KNw0gdTu9evnTxlXbuo8CvUNBk8qeQl5FCClOhlg0VJBjLzvmCs4dRds/EiOxqVbCXsC+Vn5WxXSWfuTgyCgm/MffOpRMrwLu6/HDH4r2K2IadsaO5kesfREZhm2OfuHDsnFso3GCNye/s4dfI6R+ILso3phfIo/ES0SH7ryV/h+jBpFn3MhSghG2/mnP+c+jKBcWjRoWpJKqMOpM5Ko5NVlteAOFuB+oAJ8SoQQFyuGJAuLn89cLnw1aJ8svLf+E8XCgeNE15Vgvb8jmc/5WBbxcBNNVyAxTOKDA6HicP/BV5eIdQoCYnLd4hU2O+yL1a6Ayg0K6W3Axy1aCtYhrU4QEm6eDsubUugVlgQWiugRrf2QaVsMrDJU6dP0bH1mrm6r4VkKeAnP0cmx/caLGBMSmPeqLd6TwskdKL14AX2L9w/xaJ+yEJKq+pl5QUIiMFzm9z9vxrI5i1r/JNze0iuvXYCZeM5xGZR1cWP7iUxdcQrk+zRClbRUlL3RXvY/3CbqnfiD3grJlE6sJGQzInOHPozRXgW7yzcdMDKDY3oayZeC+SZRTGekn84JI/nsvXT0EmdgEeHZHqVM3ECgR7AcL6YgWz6lsyCmFe1/kD5zN6spaiok65ur5raQ6DD9Xc081eVrQUsatsIiPc6oVcVV7uEjnvX3FujUuQT3L/BuGxmqheYrkqQB3OIk+e8ZZH70a6CztDo1quad4ZydneBxDSjnpnFDVKWJIFmcBZDG5yO2aESuU32lGDO4pq6041XkuH04AnL9RXa4735iW33rbpXinuLIDyWE1GBibCeTjHqcPHmZ/7ClGTb7G+R0CVa0TmaW9+8E6kX8F5TPOtNo/h4XSeS8vfa0aIKlQx6uIjvwTcg7Np1UGa5fJGIdv/xekj/1kv+TjxLoC+73ZMAYURHkkNztBZ+EVBQvryeLa48gpAJn3A6bdeYv2GLxF9YBL2SHhmQ9X433Xx6NkmTMwKlTbMPSL1C9ipOFgjNkwTkcK2DwuGnyLeazvnnVTmhLLskllKGS15APNdQ2/xEC7JtyV8GiA6K/N98cYS0hOFilfC2NhgOVRyiEuJa1R8VbbXboSJQp1avHtaX1WdYD8/xSrV5Au3gD5fqgnByEpbGaUnJ0jDs2x99H6p21ysmUfu7xGQwOwtovuLs/HeLF84ijryIMyBKopH8JV3z0l6tMQVITQSpJJf5JKI0uXuyuTo7CVrWaOXbNrwAOpuKdVkthx5LEd2/rHOHP4f5uaerBk6o3BN3lNATiINzyxt3flrqLu95BCrCVaECyOF8UlOnj3e8NY31ahbH/lVKWrCKC5fWphSXpHtIth/6L0jP2mWXLPZ23c67artQm4sbNqAtNjkUAHgxymDD5ksaxUgp9OcOXSi7/Qk6gwujZJKZ1SzaFEcfkn88OIsFQ+aRfr1jxFdDwy4EmymLBPIUiA3wW7Ywq5GXqoJ2lEIQyELllQSvCGXOhf2s9762Y2g+6aurErlKiDCmKMCh/hSUZLETLxXCMYo52upeM/IKryn9H2SlVENnZrpKawueTD7KnB9jIQnQfLmB+6iVBNm+1hbqBT5Dg8TLvAcG39xuzS3gIcB6Fx0VJqT5pvZz5rPzCN9vijJ0XJ0CY+K0SnFkNrsbizN0VpYSQ9BVvndNbzF4LDzcr/k11Wy1aByYC1PAkjrNuxE3QZwquLPJC+MOjnzI104cC5HfLWxtdrcNsamyjUyS/m73L7lIdR9spRN1Ep0DY+SQ/B/c/byj6oHjqFaZni3Ld5rxTbVhGGtGI20ZsaCeTbEd/KG3T+W6X2NjlaZ286WeuP3u7ef/0an+FTx9tTkK2OG5sqKMJP9AAp2NbLlMkkqW4hcCEt+Q+8eest37P69eme2CElWVUBtYUNOh8WxiauxV4Kfj+1SZzxJmE7UjxX/oSjDJftF9zmhz1W1fPSqM0NF4K07v032U+T0l0BfPLgFZ6ZsygrztG97cCvobpxKvo3qx1ZtYbsg5dJRhvdM80JLU0K50vBAJF+XipeYzWMSUgm/6R6j5m2FNOScyGlY0+M0wekqdqKPb+r0gTdxfg11rbxWDYWBwOkiJ5eOML/wOFHGXJSaWzh668mNcHrmvcX7Fi3dM1La2dIsCgP0cJXLl1tpXkHFw5seu9VjC+sYc/tKVdltxILDuAd3xv1HPdWz5nDqLP+Wy3DinysPyRrrThlIQH5VvHgF4glax1dMUuN95OhLXHn/+cUNizulft003jUT74UzgE/w/vferFhWlOZIn9DDKG7FZGBsYVesWvMbw6oDUs0OXK/3WBLOgXOS+m3Dbdsf5srkn8hDAvoyIJi2sNn6t2q4x2Y7vpLHZgA5n9D54+dz8NWKtUS5XIkQI/+XdbC1sKthRae4o2Ydl6TmNvq46SW7FbSMwjHXfVPvHfkJzsfLmKzV7cLWIg9Pe8ujd0vdnVO21v6npGCkDGL3FUvGjlkegCsVL+ERJWH6Q6fLMeT8w1Jo67RiHKbYN/2M/ZACJ0n6TUNgqutXsiIFOb3DqReOs75/YtrxUbNiC2cVQE5PX968/S6hX562sPVvoeIZCefhAh/45aKoa1vv6E8dOmzyXrp1PZAxCZR/Vo9QBhvnidR9iq07v8BVN9cX8gQiGb0kyDh+o1hducijLDwgDcV86QNOnXx5YSH2oN7Acg3ZXEbWJCTo5jvD3+rCgXMfRsZCkDVZ+h3n5eeI6ImuR9ER7el+Fk+PYo7og15/oHcPvI39Gt18j7SO6DvDs+bhBeQvIzoU64iun57v5ujmO7JfFW8sGb5BxHSfoityd4W1pqt/F//71p+4sMvrDlx6AJ05ehZ43Lfv+QqRPpNNF8h0FO55kytnqNbvIuv/AEj+Q5g8kslL4atzVyaX/mXjJ+fWZ/RnMQxDMU1JQfV4jpznU+IogHI8RVral3NOQQnxwCJiieXhFZ09+OKN5Pp/cNwUFb8TbsEAAAAASUVORK5CYII=';

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
// Widgets with no Le Mans Ultimate equivalent: Track Map is an iRacing web map, Tyres reads iRacing's .ibt files.
const IRACING_ONLY_WIDGETS = ['trackMap', 'tyres'];

function patchRacingOverlaySettingsHtml(src) {
  const isTab = (id) => `$root.widgetTab == '${id}'`;
  const showIn = (id) => `ng-show="${isTab(id)}" `;
  // The green "on" dot only means something for widgets; settingsMain.custom/.system don't exist.
  const tab = (id, label) =>
    `<a ${IRACING_ONLY_WIDGETS.includes(id) ? 'ng-if="!isLmu" ' : ''}ng-click="$root.widgetTab = '${id}'" ng-class="{selected: ${isTab(id)}, on: settingsMain.${id}}">${label}</a>`;
  // the same page serves iRacing's and LMU's overlays; on LMU's, an iRacing-only tab falls back to the first
  const initTab = `$root.widgetTab = !$root.widgetTab || isLmu && ${JSON.stringify(IRACING_ONLY_WIDGETS).replace(/"/g, "'")}.indexOf($root.widgetTab) >= 0 ? '${WIDGET_TABS[0][0]}' : $root.widgetTab`;
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
\t\t\t- Track Map and Tyres are iRacing-only.
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


# LMU has no class colours. Kapps' Standings tells classes apart by colour from iRacing's fixed palette
# (yellow, blue, pink, purple, green, orange, white) and orders them by it, so classes take palette
# colours in speed order, LMP2 blue and LMGT3 green as in the WEC.
CLASSES = {
    'Hyper': ('HYPER', 0xFFDA59), 'Hypercar': ('HYPER', 0xFFDA59), 'LMP2': ('LMP2', 0x33CEFF),
    'LMP2_ELMS': ('LMP2', 0xFF5888), 'LMP3': ('LMP3', 0xAE6BFF), 'GT3': ('LMGT3', 0x53FF77), 'GTE': ('GTE', 0xD35400),
}


def class_info(name):
    return CLASSES.get(name, (name.upper()[:6], 0xFFFFFF))


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
        })
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
        for s, t in cars:
            klass = text(s.mVehicleClass)
            short, colour = class_info(klass)
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
                'LmuVe': (s.mID, s.mVehicleName) in self.ve_cars,
            })
        scor, tele = player
        return {
            'DriverCarIdx': scor.mID, 'DriverUserID': scor.mSteamID, 'PaceCarIdx': -1,
            'DriverCarEstLapTime': scor.mEstimatedLapTime, 'DriverPitTrkPct': scor.mPitLapDist / (info.mLapDist or 1),
            'DriverCarFuelMaxLtr': tele.mFuelCapacity if tele else 0, 'DriverCarMaxFuelPct': 1,
            'DriverCarFuelKgPerLtr': 0.75, 'DriverCarRedLine': tele.mEngineMaxRPM if tele else 0,
            'Drivers': drivers,
        }

    @staticmethod
    def damage(tele):
        """Percent damaged: dents (8 zones, 0-2 each), a detached part (in LMU only the rear wing counts
        half) and any detached wheel, as in TinyPedal's integrity reading."""
        integrity = 1 - sum(tele.mDentSeverity) / 16 - tele.mDetached / 2 - any(w.mDetached for w in tele.mWheels)
        return round((1 - max(integrity, 0)) * 100)

    def energy(self, scor, tele):
        """Percent of virtual energy left for cars that use it (so one that runs out still shows 0% VE),
        otherwise of fuel."""
        if tele is not None and tele.mVirtualEnergy > 0:
            self.ve_cars.add((scor.mID, scor.mVehicleName))
        if (scor.mID, scor.mVehicleName) in self.ve_cars:
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

// --- New widgets: Weather, Pit Brake, Rejoin Helper, Delta Bar, Flags ---------------------
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
  };
  // Other overlay bundles that each carry their own copy of the shared widget-registry
  // module (defaultSettings/urlKeys for every widget, including driver.columns) — these
  // just need that shared module kept consistent, nothing widget-specific.
  const otherWidgetPaths = [
    overlayBase + 'tyres/tyres.js',
    overlayBase + 'standings/standings.js',
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
    patchFuelCalcJs(
      patchAvg5SharedSettings(
        patchTargetLapsSharedSettings(patchRelativesSharedSettings(files[paths.fuelCalcJs].toString('utf8'), 'fuel-calc.js'), 'fuel-calc.js'),
        'fuel-calc.js'
      )
    ),
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
  files[paths.fuelCalcHtml] = Buffer.from(patchFuelCalcHtml(files[paths.fuelCalcHtml].toString('utf8')), 'utf8');
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
  const legacyStandings = overlayBase + 'standings/standings.js';
  files[legacyStandings] = Buffer.from(skipMissingLicense(files[legacyStandings].toString('utf8'), 'if(config.showSRiRBadges', 'standings/standings.js'), 'utf8');

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
