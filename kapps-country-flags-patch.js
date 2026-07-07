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

  return src;
}

function patchSettingsCss(src) {
  const rule = `.atlas.driver.country-flag{width:25px;height:25px;background-color:#000;background-image:url(${CHIP_FLAG_DATA_URI});background-size:20px 10px;background-repeat:no-repeat;background-position:center;border-radius:2px}`;
  if (src.includes(rule)) throw new Error('settings.css already contains the country-flag chip rule — patch already applied?');
  return src + rule;
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

  files[paths.worker] = Buffer.from(patchWorker(files[paths.worker].toString('utf8')), 'utf8');
  files[paths.standingsJs] = Buffer.from(patchStandingsJs(files[paths.standingsJs].toString('utf8')), 'utf8');
  files[paths.indexHtml] = Buffer.from(patchIndexHtml(files[paths.indexHtml].toString('utf8')), 'utf8');
  files[paths.standingsCss] = Buffer.from(patchStandingsCss(files[paths.standingsCss].toString('utf8')), 'utf8');
  files[paths.settingsJs] = Buffer.from(patchSettingsJs(files[paths.settingsJs].toString('utf8')), 'utf8');
  files[paths.settingsCss] = Buffer.from(patchSettingsCss(files[paths.settingsCss].toString('utf8')), 'utf8');
  files[paths.racingOverlay] = Buffer.from(patchDefaultColumns(patchRelativesSharedSettings(files[paths.racingOverlay].toString('utf8'), 'racing-overlay.js'), 'racing-overlay.js'), 'utf8');
  files[paths.mainProcess] = Buffer.from(patchRelativesSharedSettings(patchMainProcessJs(files[paths.mainProcess].toString('utf8')), 'index.js'), 'utf8');
  files[paths.appJs] = Buffer.from(patchRelativesSharedSettings(files[paths.appJs].toString('utf8'), 'app.js'), 'utf8');
  files[paths.fuelCalcJs] = Buffer.from(patchRelativesSharedSettings(files[paths.fuelCalcJs].toString('utf8'), 'fuel-calc.js'), 'utf8');
  files[paths.relativesJs] = Buffer.from(patchRelativesJs(files[paths.relativesJs].toString('utf8')), 'utf8');
  files[paths.relativesIndexHtml] = Buffer.from(patchRelativesIndexHtml(files[paths.relativesIndexHtml].toString('utf8')), 'utf8');
  files[paths.relativesCss] = Buffer.from(patchRelativesCss(files[paths.relativesCss].toString('utf8')), 'utf8');
  files[paths.relativesSettingsHtml] = Buffer.from(patchRelativesSettingsHtml(files[paths.relativesSettingsHtml].toString('utf8')), 'utf8');

  for (const p of otherWidgetPaths) {
    let content = files[p].toString('utf8');
    content = patchDefaultColumns(content, p);
    content = patchRelativesSharedSettings(content, p);
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
