// Adds per-driver national flags to Kapps' "Standings" racing overlay widget,
// including a working drag-and-drop "Country Flag" column in its settings editor.
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
  versionDirs.sort(); // lexicographic is fine for these version strings
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
  // have it), before the template-pruning step decides which column elements survive.
  src = mustReplace(
    src,
    '})(this.headerTemplate,i.settings.header.columns,["class-border","session-type","bg"]),t(this.driverTemplate,i.settings.driver.columns,["position"])',
    '})(this.headerTemplate,i.settings.header.columns,["class-border","session-type","bg"]),i.settings.driver.columns.includes("country-flag")||i.settings.driver.columns.splice(i.settings.driver.columns.indexOf("name")+1,0,"country-flag"),t(this.driverTemplate,i.settings.driver.columns,["position"])',
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
  // 1) Flat {className,name,width} registry used for the chip's initial metadata.
  src = mustReplace(
    src,
    '{"className":"car-manufacture","name":"carManufacture","width":35}',
    '{"className":"country-flag","name":"countryFlag","width":25},{"className":"car-manufacture","name":"carManufacture","width":35}',
    'settings.js flat column registry'
  );

  // 2) Module-4700-style per-variant width table (40 entries — one per size/style preset).
  const widths40 = Array.from({ length: 40 }, () => '25').join(',');
  src = mustReplace(
    src,
    '{"name":"carManufacture","width":[20,28,36,42,20,26,34,38,20,28,36,42,20,26,34,38,20,28,36,42,20,26,34,38,20,27,35,41,20,25,33,37,20,26,35,39,20,26,33,37]}',
    `{"name":"countryFlag","width":[${widths40}]},{"name":"carManufacture","width":[20,28,36,42,20,26,34,38,20,28,36,42,20,26,34,38,20,28,36,42,20,26,34,38,20,27,35,41,20,25,33,37,20,26,35,39,20,26,33,37]}`,
    'settings.js width-variant registry'
  );

  // 3) Ensure "country-flag" gets injected into whatever driver.columns array is loaded
  //    (persisted settings won't know about it), BEFORE the chip placement decision runs —
  //    doing this too late leaves the chip stuck in the "available" drop area.
  src = mustReplace(
    src,
    'for(He=a[Be],Ne=document.querySelectorAll(`.row.${Be}`)',
    'for(("driver"!==Be||this.data[Be].columns.includes("country-flag")||this.data[Be].columns.splice(this.data[Be].columns.indexOf("name")+1,0,"country-flag")),He=a[Be],Ne=document.querySelectorAll(`.row.${Be}`)',
    'settings.js early column injection'
  );

  // 4) A second, later pass re-appends columns in driver.columns order to fix drag-drop
  //    ordering — needs the same defensive injection or a persisted settings array without
  //    "country-flag" leaves it un-reordered here too.
  src = mustReplace(
    src,
    'Pe.setInstances(Ae),se=0,F=(ce=this.data[Be].columns).length',
    'Pe.setInstances(Ae),("driver"!==Be||this.data[Be].columns.includes("country-flag")||this.data[Be].columns.splice(this.data[Be].columns.indexOf("name")+1,0,"country-flag")),se=0,F=(ce=this.data[Be].columns).length',
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
    '"isPBLapTime","isBestLapTime","fastestLap","isPractice","tyreCompound","joker","gainHistory"',
    'worker.js mainKeys fastestLap'
  );
  src = mustReplace(
    src,
    'i.isBestLapTime=null,i.tyreCompound=null',
    'i.isBestLapTime=null,i.fastestLap=null,i.isPractice=null,i.tyreCompound=null',
    'worker.js reset fastestLap'
  );
  // lapTime/gap/int are computed independently across three session-state branches, each
  // reading from a different source field — fastestLap needs adding to all three or it
  // silently never populates outside of Race sessions. Alongside it, isPractice records
  // whether the CURRENT tick is a Practice session, for the "Hide in Practice" setting below.
  //
  // Branch 1 (guarded by the Race-results check) and branch 3 (guarded by
  // Q.isRaceStarted===true — an early-race fallback that still has stale qualify-position
  // data available) are both Race-context and never Practice. Branch 2 (guarded by
  // !Q.isRaceStarted) is shared by BOTH Qualify and Practice — matching the settings UI's
  // combined "p&q" precision bucket — so isPractice there must be read from the actual
  // SessionType string rather than hardcoded.
  src = mustReplace(
    src,
    'l.lapTime=u?.001*(1e3*B.LastTime|0):null,B.LapsComplete>1&&(g=B.FastestLap===B.LapsComplete)',
    'l.lapTime=u?.001*(1e3*B.LastTime|0):null,l.fastestLap=B.FastestTime>0?.001*(1e3*B.FastestTime|0):null,l.isPractice=!1,B.LapsComplete>1&&(g=B.FastestLap===B.LapsComplete)',
    'worker.js race-branch fastestLap'
  );
  src = mustReplace(
    src,
    's&&u&&(l.lapTime=.001*(1e3*B.Time|0))),l.gapData.ppq=B,E.set(a,n))',
    's&&u&&(l.lapTime=.001*(1e3*B.Time|0),l.fastestLap=B.FastestTime>0?.001*(1e3*B.FastestTime|0):null,l.isPractice="Practice"===_.SessionType)),l.gapData.ppq=B,E.set(a,n))',
    'worker.js qualify/practice-branch fastestLap'
  );
  src = mustReplace(
    src,
    'l.lapTime=o>0?o:null,C.WeekendInfo.HeatRacing',
    'l.lapTime=o>0?o:null,l.fastestLap=B.FastestTime>0?.001*(1e3*B.FastestTime|0):null,l.isPractice=!1,C.WeekendInfo.HeatRacing',
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
  // the value (same "hidden" toggle other conditionally-shown columns use) when there's no
  // value OR the user has "Hide in Practice" on and we're in a practice session.
  src = mustReplace(
    src,
    'this.dataContentEls.has("lapTime")&&this.data._apply.lapTime&&([I,C,r]=this.getApplyData("lapTime"),null!=I?(_=h.sessionData.isRaceStarted?"race":"pandq",x=function(){if(I>=599.95)return 1;switch(l.settings.driver.lapTime[_].precision){case"fractions-3":return 3;case"fractions-2":return 2;case"fractions-1":return 1}}(),r.textContent=p(I,x)):r.textContent="",r.classList.toggle("hidden",null==I)),this.dataContentEls.has("tyreCompound")',
    'this.dataContentEls.has("lapTime")&&this.data._apply.lapTime&&([I,C,r]=this.getApplyData("lapTime"),null!=I?(_=h.sessionData.isRaceStarted?"race":"pandq",x=function(){if(I>=599.95)return 1;switch(l.settings.driver.lapTime[_].precision){case"fractions-3":return 3;case"fractions-2":return 2;case"fractions-1":return 1}}(),r.textContent=p(I,x)):r.textContent="",r.classList.toggle("hidden",null==I)),this.dataContentEls.has("fastestLap")&&this.data._apply.fastestLap&&([I,C,r]=this.getApplyData("fastestLap"),null!=I?(_=h.sessionData.isRaceStarted?"race":"pandq",x=function(){if(I>=599.95)return 1;switch((l.settings.driver.fastestLap&&l.settings.driver.fastestLap[_]&&l.settings.driver.fastestLap[_].precision)||"fractions-3"){case"fractions-3":return 3;case"fractions-2":return 2;case"fractions-1":return 1}}(),r.textContent=p(I,x)):r.textContent="",r.classList.toggle("hidden",null==I||this.data.isPractice&&l.settings.driver.fastestLap&&l.settings.driver.fastestLap.hideInPractice)),this.dataContentEls.has("tyreCompound")',
    'standings.js apply-block fastestLap'
  );
  // Reveal step: copies the formatted text from the hidden "fake" element into the visible
  // "real" sibling. Every column needing this has its own dedicated revealXXX(), dispatched
  // from revealAll() — a bare data pipeline with no reveal step just never displays anything.
  // The purple "fastest lap" fill is a separate reveal step keyed off this.style.bestLapTime —
  // gate it too, so a hidden-in-practice cell doesn't show an empty purple box.
  src = mustReplace(
    src,
    'this.dataContentEls.has("lapTime")&&this.revealLapTime(),',
    'this.dataContentEls.has("lapTime")&&this.revealLapTime(),this.dataContentEls.has("fastestLap")&&this.revealFastestLap(),',
    'standings.js revealAll dispatcher fastestLap'
  );
  src = mustReplace(
    src,
    'async revealTyreCompound(){',
    'async revealFastestLap(){if(this.data._reveal.fastestLap){var e=this.dataContentEls.get("fastestLap");e.nextElementSibling.textContent=e.textContent}this.data._reveal.isBestLapTime&&(this.style.bestLapTime=this.data.isBestLapTime&&!(this.data.isPractice&&l.settings.driver.fastestLap&&l.settings.driver.fastestLap.hideInPractice))}async revealTyreCompound(){',
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
    'lapTime:{pandq:{precision:"fractions-3"},race:{precision:"fractions-1"}},fastestLap:{pandq:{precision:"fractions-3"},race:{precision:"fractions-1"},hideInPractice:!1},pit:{style:"pit-time"}',
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

  // 2) Module-4700-style per-variant width table (JSON.parse blob) — same structure/values.
  src = mustReplace(
    src,
    '{"name":"lapTime","options":[{"options":["fractions-3"],"width":[56,69,93,106,56,67,91,102,59,78,89,112,59,76,87,108,59,78,94,112,59,76,92,108,59,68,80,103,59,66,78,99,54,61,82,98,54,61,80,96]},{"options":["fractions-2"],"width":[50,62,83,95,50,60,81,91,53,69,80,100,53,67,78,96,53,69,84,100,53,67,82,96,53,61,71,92,53,59,69,88,48,54,74,87,48,54,72,85]},{"options":["fractions-1"],"width":[44,54,73,84,44,52,71,80,46,61,70,88,46,59,68,84,46,61,74,88,46,59,72,84,46,54,63,81,46,52,61,77,42,48,65,77,42,48,63,75]}]}',
    '{"name":"lapTime","options":[{"options":["fractions-3"],"width":[56,69,93,106,56,67,91,102,59,78,89,112,59,76,87,108,59,78,94,112,59,76,92,108,59,68,80,103,59,66,78,99,54,61,82,98,54,61,80,96]},{"options":["fractions-2"],"width":[50,62,83,95,50,60,81,91,53,69,80,100,53,67,78,96,53,69,84,100,53,67,82,96,53,61,71,92,53,59,69,88,48,54,74,87,48,54,72,85]},{"options":["fractions-1"],"width":[44,54,73,84,44,52,71,80,46,61,70,88,46,59,68,84,46,61,74,88,46,59,72,84,46,54,63,81,46,52,61,77,42,48,65,77,42,48,63,75]}]},{"name":"fastestLap","options":[{"options":["fractions-3"],"width":[56,69,93,106,56,67,91,102,59,78,89,112,59,76,87,108,59,78,94,112,59,76,92,108,59,68,80,103,59,66,78,99,54,61,82,98,54,61,80,96]},{"options":["fractions-2"],"width":[50,62,83,95,50,60,81,91,53,69,80,100,53,67,78,96,53,69,84,100,53,67,82,96,53,61,71,92,53,59,69,88,48,54,74,87,48,54,72,85]},{"options":["fractions-1"],"width":[44,54,73,84,44,52,71,80,46,61,70,88,46,59,68,84,46,61,74,88,46,59,72,84,46,54,63,81,46,52,61,77,42,48,65,77,42,48,63,75]}]}',
    'settings.js width-variant registry fastest-lap'
  );

  // 3) Precision-options map — drives the actual hover-popup contents, distinct from the width
  //    table above. Without this, createOptionContentPQR reads undefined.precision and throws,
  //    blanking the entire settings editor before it paints anything.
  src = mustReplace(
    src,
    'lapTime:{precision:[{id:"fractions-3"},{id:"fractions-2"},{id:"fractions-1"}]},pit:{style:',
    'lapTime:{precision:[{id:"fractions-3"},{id:"fractions-2"},{id:"fractions-1"}]},fastestLap:{precision:[{id:"fractions-3"},{id:"fractions-2"},{id:"fractions-1"}]},pit:{style:',
    'settings.js precision-options map fastestLap'
  );

  // 4) The P&Q/Race precision popup UI is a hardcoded switch(columnName). fastestLap gets its
  //    own case (not a fall-through from lapTime) so it can carry an extra "Hide in Practice"
  //    checkbox that Last Lap Time has no equivalent need for — bound to
  //    driver.fastestLap.hideInPractice via the same for-in/assignDataBind idiom the
  //    tyreCompound "Always On" checkbox above already uses.
  src = mustReplace(
    src,
    'case"lapTime":(v=document.createElement("div")).classList.add("options",Be,M.className),te=this.createOptionContentPQR(b,Be,M,M,"pandq","precision"),(S=v.appendChild(document.createElement("header"))).textContent="p&q",te.prepend(S),v.appendChild(te),te=this.createOptionContentPQR(b,Be,M,M,"race","precision"),(S=v.appendChild(document.createElement("header"))).textContent="race",te.prepend(S),v.appendChild(te);break',
    'case"lapTime":(v=document.createElement("div")).classList.add("options",Be,M.className),te=this.createOptionContentPQR(b,Be,M,M,"pandq","precision"),(S=v.appendChild(document.createElement("header"))).textContent="p&q",te.prepend(S),v.appendChild(te),te=this.createOptionContentPQR(b,Be,M,M,"race","precision"),(S=v.appendChild(document.createElement("header"))).textContent="race",te.prepend(S),v.appendChild(te);break;case"fastestLap":(v=document.createElement("div")).classList.add("options",Be,M.className),te=this.createOptionContentPQR(b,Be,M,M,"pandq","precision"),(S=v.appendChild(document.createElement("header"))).textContent="p&q",te.prepend(S),v.appendChild(te),te=this.createOptionContentPQR(b,Be,M,M,"race","precision"),(S=v.appendChild(document.createElement("header"))).textContent="race",te.prepend(S),v.appendChild(te);for(t in(te=v.appendChild(document.createElement("div"))).classList.add("form"),E=te.appendChild(document.createElement("input")),Re={type:"checkbox",id:k=`${Be}.${M.name}.hideInPractice`,"data-bind":k})n=Re[t],E.setAttribute(t,n);(L=te.appendChild(document.createElement("label"))).textContent="Hide in Practice",L.htmlFor=E.id,this.assignDataBind(E);break',
    'settings.js fastestLap popup case + hideInPractice checkbox'
  );

  // 5) defaultSettings entry.
  src = mustReplace(
    src,
    'lapTime:{pandq:{precision:"fractions-3"},race:{precision:"fractions-1"}},pit:{style:"pit-time"}',
    'lapTime:{pandq:{precision:"fractions-3"},race:{precision:"fractions-1"}},fastestLap:{pandq:{precision:"fractions-3"},race:{precision:"fractions-1"},hideInPractice:!1},pit:{style:"pit-time"}',
    'settings.js fastestLap defaultSettings'
  );

  // 6) Backfill this.data.driver.fastestLap for existing users whose saved settings predate
  //    this column — the chip-generation loop reads this.data.driver.fastestLap.precision
  //    unconditionally for any column with precision sub-options, and a genuinely-undefined
  //    (not just missing-key) parent object throws there, blanking the whole editor.
  src = mustReplace(
    src,
    'null==(l=this.data.colors).bgLightness&&(l.bgLightness=this.defaultSettings.colors.bgLightness),De={header:',
    'null==(l=this.data.colors).bgLightness&&(l.bgLightness=this.defaultSettings.colors.bgLightness),null==this.data.driver.fastestLap&&(this.data.driver.fastestLap=JSON.parse(JSON.stringify(this.defaultSettings.driver.fastestLap))),De={header:',
    'settings.js constructor fastestLap data backfill'
  );

  // 7) getBoundsBySettings does its own independent shallow settings merge (used to size the
  //    Preview panel) — needs the same backfill or it throws mid-render and Preview stays blank.
  src = mustReplace(
    src,
    'p=(N=s.getById("standings2")).defaultSettings.settings,e=o({},p,e),t={width:{header:0,driver:{pandq:0,race:0}},height:0},u=a(e.font,e.condensed,e.header.size)',
    'p=(N=s.getById("standings2")).defaultSettings.settings,e=o({},p,e),null==e.driver.fastestLap&&(e.driver.fastestLap=p.driver.fastestLap),t={width:{header:0,driver:{pandq:0,race:0}},height:0},u=a(e.font,e.condensed,e.header.size)',
    'settings.js getBoundsBySettings fastestLap backfill'
  );

  // 8) Width-SUM calculation (separate from the width table in step 2) needs fastest-lap added
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
  const rule = '.atlas.driver.fastest-lap.precision-fractions-3{width:80px;height:25px;background-position:-347px -500px}.atlas.driver.fastest-lap.precision-fractions-2{width:71px;height:25px;background-position:-427px -500px}.atlas.driver.fastest-lap.precision-fractions-1{width:63px;height:25px;background-position:0 -525px}.atlas.driver.fastest-lap{background-color:#8b3ef2;background-blend-mode:multiply}';
  if (src.includes(rule)) throw new Error('settings.css already contains the fastest-lap atlas rule — patch already applied?');
  return src + rule;
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

// index.js is Kapps' actual Electron main process (window creation, opening layers) — a
// completely separate bundle from the renderer files above. It carries its own independent
// copy of the same per-variant width registry used to size the standings2 window when a
// layer is opened; without this fix, opening a layer with the flag column active crashes
// that size calculation and the layer's windows never open.
function patchMainProcessJs(src) {
  const widths40 = Array.from({ length: 40 }, () => '25').join(',');
  src = mustReplace(
    src,
    '{"name":"carManufacture","width":[20,28,36,42,20,26,34,38,20,28,36,42,20,26,34,38,20,28,36,42,20,26,34,38,20,27,35,41,20,25,33,37,20,26,35,39,20,26,33,37]}',
    `{"name":"countryFlag","width":[${widths40}]},{"name":"carManufacture","width":[20,28,36,42,20,26,34,38,20,28,36,42,20,26,34,38,20,28,36,42,20,26,34,38,20,27,35,41,20,25,33,37,20,26,35,39,20,26,33,37]}`,
    'index.js width-variant registry'
  );
  src = patchDefaultColumns(src, 'index.js');
  return src;
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
    '\t\t<!-- country flag -->\r\n\t\t<div class="form-group">\r\n\t\t\t<label for="inputRelativesCountryFlag" class="col-sm-3 control-label">Country Flag</label>\r\n\t\t\t<div class="col-sm-9">\r\n\t\t\t\t<label class="checkbox-inline">\r\n\t\t\t\t\t<input ng-model="settings.showCountryFlag" ng-change="saveSettings()" type="checkbox" id="inputRelativesCountryFlag">\r\n\t\t\t\t\tShow driver\'s national flag\r\n\t\t\t\t</label>\r\n\t\t\t</div>\r\n\t\t</div>\r\n\t\t<!-- driver name style -->',
    'settings/relatives.html checkbox'
  );
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
        patchRelativesSharedSettings(patchWorkerFastestLap(patchWorker(files[paths.worker].toString('utf8'))), 'worker.js'),
        'worker.js'
      ),
      'worker.js'
    ),
    'utf8'
  );
  files[paths.standingsJs] = Buffer.from(
    patchAvg5SharedSettings(
      patchTargetLapsSharedSettings(
        patchRelativesSharedSettings(patchStandingsJsFastestLap(patchStandingsJs(files[paths.standingsJs].toString('utf8'))), 'standings.js'),
        'standings.js'
      ),
      'standings.js'
    ),
    'utf8'
  );
  files[paths.indexHtml] = Buffer.from(patchIndexHtmlFastestLap(patchIndexHtml(files[paths.indexHtml].toString('utf8'))), 'utf8');
  files[paths.standingsCss] = Buffer.from(patchStandingsCssFastestLap(patchStandingsCss(files[paths.standingsCss].toString('utf8'))), 'utf8');
  // settings.js also carries the same dead-weight shared-registry duplication (it doesn't use
  // driver.columns/showCountryFlag for anything itself, but the webpack bundle embeds a copy
  // regardless) — was never getting patchDefaultColumns/patchRelativesSharedSettings either.
  files[paths.settingsJs] = Buffer.from(
    patchAvg5SharedSettings(
      patchTargetLapsSharedSettings(
        patchRelativesSharedSettings(patchDefaultColumns(patchSettingsJsFastestLap(patchSettingsJs(files[paths.settingsJs].toString('utf8'))), 'settings.js'), 'settings.js'),
        'settings.js'
      ),
      'settings.js'
    ),
    'utf8'
  );
  files[paths.settingsCss] = Buffer.from(patchSettingsCssFastestLap(patchSettingsCss(files[paths.settingsCss].toString('utf8'))), 'utf8');
  files[paths.racingOverlay] = Buffer.from(
    patchAvg5SharedSettings(
      patchTargetLapsSharedSettings(patchDefaultColumns(patchRelativesSharedSettings(files[paths.racingOverlay].toString('utf8'), 'racing-overlay.js'), 'racing-overlay.js'), 'racing-overlay.js'),
      'racing-overlay.js'
    ),
    'utf8'
  );
  files[paths.mainProcess] = Buffer.from(
    patchAvg5SharedSettings(
      patchTargetLapsSharedSettings(patchRelativesSharedSettings(patchMainProcessJs(files[paths.mainProcess].toString('utf8')), 'index.js'), 'index.js'),
      'index.js'
    ),
    'utf8'
  );
  files[paths.appJs] = Buffer.from(
    patchAvg5SharedSettings(
      patchTargetLapsSharedSettings(patchRelativesSharedSettings(files[paths.appJs].toString('utf8'), 'app.js'), 'app.js'),
      'app.js'
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
      patchTargetLapsSharedSettings(patchRelativesJs(files[paths.relativesJs].toString('utf8')), 'relatives.js'),
      'relatives.js'
    ),
    'utf8'
  );
  files[paths.relativesIndexHtml] = Buffer.from(patchRelativesIndexHtml(files[paths.relativesIndexHtml].toString('utf8')), 'utf8');
  files[paths.relativesCss] = Buffer.from(patchRelativesCss(files[paths.relativesCss].toString('utf8')), 'utf8');
  files[paths.relativesSettingsHtml] = Buffer.from(patchRelativesSettingsHtml(files[paths.relativesSettingsHtml].toString('utf8')), 'utf8');
  files[paths.fuelCalcHtml] = Buffer.from(patchFuelCalcHtml(files[paths.fuelCalcHtml].toString('utf8')), 'utf8');
  files[paths.fuelCalcCss] = Buffer.from(patchFuelCalcCss(files[paths.fuelCalcCss].toString('utf8')), 'utf8');
  files[paths.fuelCalcSettingsHtml] = Buffer.from(patchFuelCalcSettingsHtml(files[paths.fuelCalcSettingsHtml].toString('utf8')), 'utf8');
  files[paths.racingOverlayFuelCalcSettingsHtml] = Buffer.from(
    patchRacingOverlayFuelCalcSettingsHtml(files[paths.racingOverlayFuelCalcSettingsHtml].toString('utf8')),
    'utf8'
  );

  for (const p of otherWidgetPaths) {
    let content = files[p].toString('utf8');
    content = patchDefaultColumns(content, p);
    content = patchRelativesSharedSettings(content, p);
    content = patchTargetLapsSharedSettings(content, p);
    content = patchAvg5SharedSettings(content, p);
    files[p] = Buffer.from(content, 'utf8');
  }

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
