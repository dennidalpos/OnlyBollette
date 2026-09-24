import type { Category, ElectricityParameters } from './types';
import { estimateElectricityRates, type ElectricityEstimate } from './electricity';
import { energyComponents } from './documentEnergy';

export type DocumentRole = 'current' | 'terms' | 'quote';
export interface DocumentWord {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface DocumentPage {
  number: number;
  text: string;
  lines?: { words: DocumentWord[] }[];
}
export interface DocumentAnalysis {
  fileName: string;
  pages: DocumentPage[];
  readable: boolean;
}
export interface FieldValue {
  value: string;
  document: string;
  page: number;
  confirmed: boolean;
  period?: string;
}
export interface Clause {
  text: string;
  document: string;
  page: number;
  role: DocumentRole;
  kind?: 'expiry' | 'continuation' | 'other';
}
export type Fields = Record<string, FieldValue>;

export interface FieldSpec {
  key: string;
  label: string;
  unit?: string;
  pattern?: RegExp;
  required?: boolean;
}

const number = '([\\d.]+(?:,\\d{1,4})?)';
const euro = `${number}\\s*(?:€|euro)`;
const unitPrice = `${number}\\s*(?:€\\s*\\/\\s*(?:kWh|Smc)|€\\s+(?:kWh|Smc))`;
const field = (
  key: string,
  label: string,
  unit = '',
  pattern?: RegExp,
  required = false,
): FieldSpec => ({ key, label, unit, pattern, required });

export function fieldSpecs(category: Category, role: DocumentRole): FieldSpec[] {
  const suffix = role === 'quote' ? 'Quote' : 'Current';
  if (category === 'luce' || category === 'gas') {
    const unit = category === 'luce' ? 'kWh' : 'Smc';
    return [
      field(`usage${suffix}`, 'Consumo annuo', unit, undefined, true),
      ...(category === 'luce'
        ? [field(`tariff${suffix}`, 'Tariffa (monoraria/bioraria/multioraria)', '')]
        : []),
      ...(category === 'luce' && role === 'current'
        ? [field('powerCurrent', 'Potenza impegnata', 'kW')]
        : []),
      ...(category === 'luce' && role === 'current'
        ? [field('residentCurrent', 'Residenza (residente/non residente)', '')]
        : []),
      field(
        `annual${suffix}`,
        'Spesa annua stimata',
        '€',
        new RegExp(
          `(?:spesa annua (?:stimata|prevista)|stima della spesa annua)[^\\n]{0,70}?${euro}`,
          'i',
        ),
      ),
      field(
        `unit${suffix}`,
        'Prezzo vendita unitario',
        `€/${unit}`,
        new RegExp(
          `(?:componente energia|prezzo (?:della )?materia (?:energia|gas)|prezzo (?:di )?vendita|corrispettivo (?:di )?vendita)[^\\n]{0,75}?${unitPrice}`,
          'i',
        ),
      ),
      field(
        `fixed${suffix}`,
        'Quota vendita fissa annua',
        '€',
        new RegExp(
          `(?:quota fissa (?:di )?vendita|commercializzazione|corrispettivo fisso vendita)[^\\n]{0,65}?${euro}[^\\n]{0,15}?(?:anno|annui|\\/a)`,
          'i',
        ),
      ),
      field(
        `priceType${suffix}`,
        'Tipo di prezzo',
        '',
        /prezzo[^\n]{0,25}?\b(fisso|variabile|indicizzato)\b/i,
        true,
      ),
      ...(category === 'luce'
        ? [
            field(`losses${suffix}`, 'Perdite nel prezzo (incluse/escluse)'),
            field(`lossPercent${suffix}`, 'Perdite se escluse', '%'),
            field(`dispatchMode${suffix}`, 'Dispacciamento (incluso/separato/parametro ufficiale)'),
            field(`dispatchUnit${suffix}`, 'Dispacciamento separato', '€/kWh'),
            field(`commercialMode${suffix}`, 'DISPbt (inclusa/separata/parametro ufficiale)'),
            field(`commercialAnnual${suffix}`, 'DISPbt separata annua', '€'),
          ]
        : []),
      field(`code${suffix}`, 'Codice offerta', '', /codice offerta[^\n]{0,45}?([A-Z0-9_-]{8,})/i),
      field(`valid${suffix}`, 'Scadenza stampata delle condizioni', ''),
      field(`applicableFrom${suffix}`, 'Condizioni applicabili dal (gg/mm/aaaa)'),
      field(`applicableUntil${suffix}`, 'Condizioni applicabili fino al (gg/mm/aaaa)'),
      field(
        `exit${suffix}`,
        'Onere massimo di recesso',
        '€',
        new RegExp(`(?:onere|penale) (?:di )?recesso[^\\n]{0,60}?${euro}`, 'i'),
      ),
    ];
  }
  if (category === 'internet')
    return [
      field(
        `monthly${suffix}`,
        'Canone mensile',
        '€',
        new RegExp(`(?:canone mensile|costo mensile|al mese)[^\\n]{0,55}?${euro}`, 'i'),
        true,
      ),
      field(
        `monthlyAfter${suffix}`,
        'Canone dopo promozione',
        '€',
        new RegExp(`(?:dopo (?:la )?promozione|dal \\d+°? mese)[^\\n]{0,55}?${euro}`, 'i'),
      ),
      field(
        `promoMonths${suffix}`,
        role === 'current'
          ? 'Mesi promozione rimanenti (0 se assente)'
          : 'Durata promozione (0 se assente)',
        'mesi',
        role === 'quote' ? /(?:promozione|sconto)[^\n]{0,60}?(\d{1,2})\s*mesi/i : undefined,
      ),
      field(
        `activation${suffix}`,
        role === 'current' ? 'Attivazione futura (0 se già pagata)' : 'Attivazione',
        '€',
        role === 'quote' ? new RegExp(`attivazione[^\\n]{0,45}?${euro}`, 'i') : undefined,
      ),
      field(
        `device${suffix}`,
        'Rata apparato mensile',
        '€',
        new RegExp(`(?:modem|router|apparato)[^\\n]{0,50}?${euro}[^\\n]{0,15}?(?:mese|rata)`, 'i'),
      ),
      field(
        `deviceMonths${suffix}`,
        'Rate apparato residue',
        'mesi',
        role === 'quote' ? /(?:modem|router|apparato)[^\n]{0,70}?(\d{1,2})\s*rate/i : undefined,
      ),
      field(
        `exit${suffix}`,
        'Costo di uscita',
        '€',
        new RegExp(`(?:disattivazione|recesso|migrazione)[^\\n]{0,55}?${euro}`, 'i'),
      ),
      field(
        `service${suffix}`,
        'Tipo di servizio',
        '',
        /\b(fibra|ftth|fttc|adsl|fwa|mobile)\b/i,
        true,
      ),
    ];
  return [
    field(
      `premium${suffix}`,
      'Premio annuo',
      '€',
      new RegExp(`(?:premio annuo|premio totale|premio lordo)[^\\n]{0,60}?${euro}`, 'i'),
      true,
    ),
    field(
      `coverage${suffix}`,
      'Garanzia principale',
      '',
      /\b(rc auto|responsabilità civile|incendio|furto|infortuni|malattia|viaggio|animali)\b/i,
      true,
    ),
    field(`limit${suffix}`, 'Massimale', '€', new RegExp(`massimale[^\\n]{0,50}?${euro}`, 'i')),
    field(
      `deductible${suffix}`,
      'Franchigia',
      '€',
      new RegExp(`franchigia[^\\n]{0,50}?${euro}`, 'i'),
    ),
    field(
      `expiry${suffix}`,
      'Scadenza polizza/preventivo',
      '',
      /(?:scadenza|validità)[^\n]{0,40}?(\d{2}[/.]\d{2}[/.]\d{4})/i,
    ),
  ];
}

function pageRows(page: DocumentPage): DocumentWord[] {
  if (!page.lines)
    return page.text.split(/\r?\n/).map((text, index) => ({
      text: text.trim(),
      x: 0,
      y: index * 30,
      width: 0,
      height: 20,
    }));
  const rows: DocumentWord[] = [];
  for (const line of page.lines) {
    let segment: DocumentWord | undefined;
    for (const word of [...line.words].sort((a, b) => a.x - b.x)) {
      if (!word.text.trim()) continue;
      // OCR can put both columns on one line. Retain separate table cells too.
      if (
        !segment ||
        word.x - segment.x - segment.width > 2 * Math.max(segment.height, word.height)
      ) {
        segment = { ...word };
        rows.push(segment);
      } else {
        const right = Math.max(segment.x + segment.width, word.x + word.width);
        const bottom = Math.max(segment.y + segment.height, word.y + word.height);
        segment.text += ` ${word.text}`;
        segment.y = Math.min(segment.y, word.y);
        segment.width = right - segment.x;
        segment.height = bottom - segment.y;
      }
    }
  }
  return rows.sort((a, b) => a.y - b.y || a.x - b.x);
}

function neighboringRow(rows: DocumentWord[], row: DocumentWord, direction: -1 | 1) {
  return rows
    .filter((other) => {
      const distance = (other.y - row.y) * direction;
      return (
        distance > Math.min(row.height, other.height) / 2 &&
        distance <= 2.5 * Math.max(row.height, other.height) &&
        Math.abs(other.x - row.x) <= Math.min(row.height, other.height)
      );
    })
    .sort((a, b) => Math.abs(a.y - row.y) - Math.abs(b.y - row.y))[0];
}

function profileSection(text: string): 'supply' | 'usage' | 'other' | undefined {
  if (
    /^(?:dati|caratteristiche|riepilogo) (?:tecnic(?:i|he) |contrattuali )?(?:(?:della|di) )?(?:fornitura|contratto)|^la tua fornitura/i.test(
      text,
    )
  )
    return 'supply';
  if (/^(?:i tuoi consumi|riepilogo consumi|consumi|dati di consumo)\s*:?$/i.test(text))
    return 'usage';
  if (
    /^(?:informazioni|note|comunicazioni|glossario|guida|dettaglio importi|condizioni|spesa|oneri|imposte)\b/i.test(
      text,
    )
  )
    return 'other';
}

function profileValues(rows: DocumentWord[], key: string, unit: string): string[] {
  const headings = rows.filter((row) => !!profileSection(row.text));
  const section = (row: DocumentWord) =>
    headings
      .filter((header) => {
        const right = Math.min(
          ...headings
            .filter((other) => other.x > header.x + 3 * header.height)
            .map((other) => other.x - other.height),
        );
        return header.y <= row.y && row.x >= header.x - header.height && row.x < right;
      })
      .sort((a, b) => b.y - a.y)[0];
  const usage = key.startsWith('usage');
  const resident = key.startsWith('resident');
  const power = key.startsWith('power');
  const label = usage
    ? /^(?:consumo annuo|consumo annuale|consumi annui|consumo degli ultimi 12 mesi)\b/i
    : resident
      ? /^(?:tipologia (?:di )?(?:cliente|utenza)|tipo (?:di )?cliente|cliente domestico|uso domestico|domestico|residenza)\b/i
      : power
        ? /^potenza (?:contrattualmente )?impegnata\b/i
        : /^(?:(?:tipologia (?:di )?|opzione )?tariffa(?:ria)?|tipologia prezzo|monorari[ao]|biorari[ao]|multiorari[ao])\b/i;
  const valuePattern = usage
    ? new RegExp(`${number}\\s*${unit}\\b`, 'i')
    : resident
      ? /\b(non resident[ei]|resident[ei])\b/i
      : power
        ? /([\d.,]+)\s*kW\b/i
        : /\b(monorari[ao]|biorari[ao]|multiorari[ao])\b/i;
  const values: string[] = [];
  for (const row of rows) {
    if (!label.test(row.text)) continue;
    const header = section(row);
    const kind = header && profileSection(header.text);
    if (kind === 'other' || (!usage && kind === 'usage') || (resident && kind !== 'supply'))
      continue;
    let text = row.text;
    // Only join a unique value cell in the same recognized section.
    if (header && !valuePattern.test(text)) {
      const peers = rows.filter(
        (other) =>
          other.x > row.x + row.width &&
          Math.abs(other.y - row.y) < Math.max(row.height, other.height) / 2 &&
          section(other) === header,
      );
      if (peers.length === 1) text += ` ${peers[0].text}`;
    }
    if (!valuePattern.test(text)) {
      let previous = row;
      for (let count = 0; count < 3; count++) {
        const next = neighboringRow(rows, previous, 1);
        if (!next || section(next) !== header) break;
        // A standalone value or an explicit period can continue a profile label.
        if (
          !/^(?:dal |al |periodo\b|totale\b|[\d.,]+\s*(?:kWh|Smc|kW)\b|(?:domestico )?(?:non )?residente\b|(?:mono|bi|multi)orari[ao]\b)/i.test(
            next.text,
          )
        )
          break;
        text += ` ${next.text}`;
        previous = next;
        if (valuePattern.test(text)) break;
      }
    }
    if (usage && /\b(?:F[123]|F23|fascia|fatturat[oi]|bimestre|mese)\b/i.test(text)) continue;
    if (
      usage &&
      !valuePattern.test(text) &&
      /dal\s+\d{2}[/.]\d{2}[/.]\d{4}\s+al\s+\d{2}[/.]\d{2}[/.]\d{4}/i.test(text)
    ) {
      // Annual totals may be centered badges, with the unit on the next line.
      const badges = rows.filter(
        (candidate) =>
          /^\d+(?:[.,]\d+)*$/.test(candidate.text) &&
          candidate.y > row.y &&
          candidate.y - row.y <= 12 * row.height &&
          candidate.x + candidate.width / 2 >= row.x &&
          candidate.x + candidate.width / 2 <= row.x + row.width &&
          section(candidate) === header &&
          rows.some(
            (unitRow) =>
              new RegExp(`^${unit}$`, 'i').test(unitRow.text) &&
              unitRow.y > candidate.y &&
              unitRow.y - candidate.y <= 2.5 * candidate.height &&
              Math.abs(unitRow.x + unitRow.width / 2 - candidate.x - candidate.width / 2) <=
                candidate.height,
          ),
      );
      for (const badge of badges) values.push(badge.text);
    }
    const matches = [...text.matchAll(new RegExp(valuePattern.source, 'gi'))];
    for (const match of matches) values.push(match[1]);
  }
  return values;
}

export function parseDocument(
  category: Category,
  role: DocumentRole,
  doc: DocumentAnalysis,
): { fields: Fields; clauses: Clause[]; conflicts: string[] } {
  const fields: Fields = {};
  const clauses: Clause[] = [];
  const conflicts = new Set<string>();
  for (const page of doc.pages) {
    const rows = pageRows(page);
    const text = rows.map((row) => row.text).join('\n');
    if (category === 'luce' || category === 'gas') {
      const suffix = role === 'quote' ? 'Quote' : 'Current';
      const addDate = (key: string, value: string) => {
        key += suffix;
        if (conflicts.has(key)) return;
        if (fields[key] && fields[key].value !== value) {
          delete fields[key];
          conflicts.add(key);
        } else
          fields[key] ??= { value, document: doc.fileName, page: page.number, confirmed: false };
      };
      for (const row of rows) {
        let passage = row.text;
        let previous = row;
        for (let count = 0; count < 2; count++) {
          const next = neighboringRow(rows, previous, 1);
          if (!next) break;
          passage += ` ${next.text}`;
          previous = next;
        }
        const expiry = passage.match(
          /^(?:scadenza (?:delle )?condizioni economiche|condizioni economiche fino al)\s*:?\s*(\d{2}[/.]\d{2}[/.]\d{4})/i,
        );
        if (expiry) addDate('valid', expiry[1]);
        const applicable = passage.match(
          /^condizioni economiche applicabili dal\s+(\d{2}[/.]\d{2}[/.]\d{4})\s+al\s+(\d{2}[/.]\d{2}[/.]\d{4})/i,
        );
        if (applicable) {
          addDate('applicableFrom', applicable[1]);
          addDate('applicableUntil', applicable[2]);
        }
      }
    }
    if (category === 'luce') {
      const suffix = role === 'quote' ? 'Quote' : 'Current';
      for (const component of energyComponents(
        rows,
        page.lines?.flatMap((line) => line.words),
      )) {
        const key = `${component.key}${suffix}`;
        if (conflicts.has(key)) continue;
        const previous = fields[key];
        if (previous && previous.value !== component.value) {
          delete fields[key];
          conflicts.add(key);
        } else if (!previous)
          fields[key] = {
            value: component.value,
            period: component.period,
            document: doc.fileName,
            page: page.number,
            confirmed: false,
          };
      }
    }
    for (const spec of fieldSpecs(category, role)) {
      if (category === 'luce' && /^(unit|fixed)/.test(spec.key)) continue;
      if (
        (category === 'luce' || category === 'gas') &&
        /^(usage|resident|power|tariff)/.test(spec.key)
      ) {
        for (const captured of profileValues(rows, spec.key, category === 'luce' ? 'kWh' : 'Smc')) {
          if (conflicts.has(spec.key)) continue;
          const previous = fields[spec.key];
          const normalize = (value: string) => {
            if (/^(usage|power)/.test(spec.key))
              return numeric({ value, document: '', page: 0, confirmed: true });
            return value
              .trim()
              .toLowerCase()
              .replace(/(?:monorario|biorario|multiorario)$/, (match) => `${match.slice(0, -1)}a`);
          };
          if (previous && normalize(previous.value) !== normalize(captured)) {
            delete fields[spec.key];
            conflicts.add(spec.key);
          } else if (!previous) {
            fields[spec.key] = {
              value: captured,
              document: doc.fileName,
              page: page.number,
              confirmed: false,
            };
          }
        }
        continue;
      }
      if (fields[spec.key] || !spec.pattern) continue;
      const match = text.match(spec.pattern);
      const captured = match?.slice(1).find((value) => !!value);
      if (captured)
        fields[spec.key] = {
          value: captured,
          document: doc.fileName,
          page: page.number,
          confirmed: false,
        };
    }
    for (const row of rows) {
      const trimmed = row.text;
      if (
        trimmed.length >= 8 &&
        trimmed.length <= 400 &&
        /recesso|penal|rinnov|continu|prosegu|prorog|esclusion|franchig|rivalsa|scadenz|indicizz|preavviso|durata minima|massimal/i.test(
          trimmed,
        )
      ) {
        const text = [neighboringRow(rows, row, -1), row, neighboringRow(rows, row, 1)]
          .filter((item) => !!item)
          .map((item) => item.text)
          .join(' ');
        const kind = /continu|prosegu|prorog|rinnov/i.test(trimmed)
          ? 'continuation'
          : /scadenz/i.test(trimmed)
            ? 'expiry'
            : 'other';
        clauses.push({
          text: text.slice(0, 500),
          document: doc.fileName,
          page: page.number,
          role,
          kind,
        });
      }
    }
  }
  return { fields, clauses: clauses.slice(0, 30), conflicts: [...conflicts] };
}

export function numeric(value?: FieldValue, decimal = false): number | null {
  if (!value?.confirmed) return null;
  const raw = value.value.trim().replace(/\s/g, '');
  if (!/^\d+(?:[.,]\d+)*$/.test(raw)) return null;
  const normalized =
    !decimal && /^[1-9]\d{0,2}(?:\.\d{3})+(?:,\d+)?$/.test(raw)
      ? raw.replace(/\./g, '').replace(',', '.')
      : raw.replace(',', '.');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function date(value?: FieldValue): Date | null {
  if (!value?.confirmed) return null;
  const match = value.value.match(/^(\d{2})[/.](\d{2})[/.](\d{4})$/);
  if (!match) return null;
  const parsed = new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1]));
  return parsed.getFullYear() === Number(match[3]) &&
    parsed.getMonth() === Number(match[2]) - 1 &&
    parsed.getDate() === Number(match[1])
    ? parsed
    : null;
}

export interface Comparison {
  status: 'comparable' | 'partial' | 'unavailable';
  reasons: string[];
  current: number | null;
  candidate: number | null;
  period: string;
  difference: number | null;
  notes: string[];
  next24?: { current: number; candidate: number; difference: number };
  electricityBreakdown?: { current: ElectricityEstimate; candidate: ElectricityEstimate };
}

export function compareDocuments(
  category: Category,
  fields: Fields,
  hasQuote: boolean,
  basisConfirmed: boolean,
  electricityParameters?: ElectricityParameters | null,
): Comparison {
  const reasons: string[] = [];
  const notes: string[] = [];
  const read = (key: string) => numeric(fields[key], /^(unit|dispatchUnit)/.test(key));
  const positive = (key: string) => {
    const value = read(key);
    return value !== null && value > 0 ? value : null;
  };
  const match = (key: string) =>
    fields[`${key}Current`]?.confirmed &&
    fields[`${key}Quote`]?.confirmed &&
    fields[`${key}Current`].value.trim().toLowerCase() ===
      fields[`${key}Quote`].value.trim().toLowerCase();
  let current: number | null = null;
  let candidate: number | null = null;
  let period = '12 mesi';
  let next24: Comparison['next24'];
  let electricityBreakdown: Comparison['electricityBreakdown'];
  if (!hasQuote)
    reasons.push('Carica la nuova proposta oppure conferma di averne trascritto i dati.');
  if (!basisConfirmed)
    reasons.push(
      category === 'assicurazioni'
        ? 'Conferma che garanzie, esclusioni e profilo di rischio siano equivalenti.'
        : 'Conferma che periodo, componenti di costo e condizioni siano confrontabili.',
    );
  if (category === 'luce' || category === 'gas') {
    if (positive('usageCurrent') === null || positive('usageCurrent') !== positive('usageQuote'))
      reasons.push('Conferma lo stesso consumo annuo in entrambi i documenti.');
    if (!fields.priceTypeCurrent?.confirmed || !fields.priceTypeQuote?.confirmed)
      reasons.push('Conferma il tipo di prezzo di entrambe le offerte.');
    current = positive('annualCurrent');
    candidate = positive('annualQuote');
    if (
      category === 'luce' &&
      (current === null || candidate === null) &&
      electricityParameters &&
      fields.priceTypeCurrent?.value.toLowerCase() === 'fisso' &&
      fields.priceTypeQuote?.value.toLowerCase() === 'fisso'
    ) {
      const consumption = positive('usageCurrent');
      const power = positive('powerCurrent');
      const residence = fields.residentCurrent;
      const currentUnit = positive('unitCurrent');
      const quoteUnit = positive('unitQuote');
      const currentFixed = read('fixedCurrent');
      const quoteFixed = read('fixedQuote');
      const monorate = ['tariffCurrent', 'tariffQuote'].every(
        (key) => fields[key]?.confirmed && /^monorari[ao]$/i.test(fields[key].value.trim()),
      );
      if (!monorate)
        reasons.push(
          'La stima dai prezzi unitari richiede due tariffe monorarie confermate. Per altre tariffe inserisci stime annue complete.',
        );
      const components = (suffix: string, unit: number | null) => {
        const mode = (key: string) =>
          fields[`${key}${suffix}`]?.confirmed
            ? fields[`${key}${suffix}`].value.trim().toLowerCase()
            : '';
        const losses = mode('losses');
        const percent = read(`lossPercent${suffix}`);
        const charge = (
          key: string,
          valueKey: string,
          included: string,
          separate: string,
          official: number,
        ) => {
          const rule = mode(key);
          return rule === included
            ? 0
            : rule === separate
              ? read(`${valueKey}${suffix}`)
              : rule === 'parametro ufficiale'
                ? official
                : null;
        };
        const dispatchUnit = charge(
          'dispatchMode',
          'dispatchUnit',
          'incluso',
          'separato',
          electricityParameters.values.cdispd,
        );
        const commercialAnnual = charge(
          'commercialMode',
          'commercialAnnual',
          'inclusa',
          'separata',
          electricityParameters.values.dispbt_d,
        );
        if (
          unit === null ||
          !['incluse', 'escluse'].includes(losses) ||
          (losses === 'escluse' && (percent === null || percent > 100)) ||
          dispatchUnit === null ||
          commercialAnnual === null
        )
          return null;
        return {
          unit: unit * (losses === 'escluse' ? 1 + percent! / 100 : 1),
          dispatchUnit,
          commercialAnnual,
        };
      };
      const currentComponents = components('Current', currentUnit);
      const quoteComponents = components('Quote', quoteUnit);
      if (!currentComponents || !quoteComponents)
        reasons.push(
          'Conferma perdite, dispacciamento e DISPbt, indicando le quote separate o i parametri ufficiali applicabili.',
        );
      if (
        monorate &&
        currentComponents &&
        quoteComponents &&
        consumption !== null &&
        power !== null &&
        residence?.confirmed &&
        /^(non residente|residente)$/i.test(residence.value) &&
        currentUnit !== null &&
        quoteUnit !== null &&
        currentFixed !== null &&
        quoteFixed !== null
      ) {
        const profile = {
          consumption,
          power,
          resident: residence.value.toLowerCase() === 'residente',
          tariff: 'mono' as const,
          f1Percent: 33,
        };
        const calculatedCurrent = estimateElectricityRates(
          { annualFee: currentFixed, mono: currentComponents.unit, f1: null, f23: null },
          electricityParameters,
          profile,
          new Date(),
          currentComponents,
        );
        const calculatedQuote = estimateElectricityRates(
          { annualFee: quoteFixed, mono: quoteComponents.unit, f1: null, f23: null },
          electricityParameters,
          profile,
          new Date(),
          quoteComponents,
        );
        if (calculatedCurrent && calculatedQuote) {
          current = calculatedCurrent.total;
          candidate = calculatedQuote.total;
          electricityBreakdown = { current: calculatedCurrent, candidate: calculatedQuote };
          notes.push(
            `Stime monorarie a prezzo fisso con parametri ufficiali del ${electricityParameters.publishedOn}, mantenuti costanti per 12 mesi.`,
          );
        }
      }
    }
    if (current === null || candidate === null)
      reasons.push(
        'Servono due stime annue complete per lo stesso profilo; il totale di una singola bolletta non basta.',
      );
    const horizon = new Date();
    horizon.setHours(0, 0, 0, 0);
    horizon.setFullYear(horizon.getFullYear() + 1);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    for (const suffix of ['Current', 'Quote']) {
      const from = date(fields[`applicableFrom${suffix}`]);
      const until = date(fields[`applicableUntil${suffix}`]);
      if (!from || !until || from > today || until < horizon)
        reasons.push(
          `${suffix === 'Current' ? 'Contratto attuale' : 'Nuova proposta'}: servono condizioni economiche applicabili confermate per tutti i 12 mesi. Carica le condizioni aggiornate o trascrivi il periodo documentato; una clausola di prosecuzione non basta.`,
        );
    }
    notes.push(
      'Verifica che le stime includano le stesse componenti e siano valide nello stesso periodo.',
    );
    if (read('exitCurrent') === null)
      notes.push(
        'L’eventuale costo di recesso dal contratto attuale non è incluso nella differenza.',
      );
    if (
      [fields.priceTypeCurrent?.value, fields.priceTypeQuote?.value].some((type) =>
        /variabile|indicizzato/i.test(type ?? ''),
      )
    )
      notes.push(
        'Per i prezzi indicizzati il risultato è uno scenario basato sui valori dell’indice usati nelle stime, non una previsione del prezzo futuro.',
      );
    if (fields.validCurrent?.confirmed || fields.validQuote?.confirmed)
      notes.push(
        'La scadenza stampata è distinta dal periodo applicabile confermato; verifica eventuali condizioni sostitutive.',
      );
  } else if (category === 'internet') {
    if (!match('service')) reasons.push('Conferma lo stesso tipo di servizio nelle due offerte.');
    const amount = (suffix: string, horizon: 12 | 24) => {
      const base = positive(`monthly${suffix}`);
      const after = read(`monthlyAfter${suffix}`);
      const months = read(`promoMonths${suffix}`);
      const activation = read(`activation${suffix}`);
      const device = read(`device${suffix}`);
      const deviceMonths = read(`deviceMonths${suffix}`);
      if (base === null || months === null || months > 24 || activation === null || device === null)
        return null;
      if (months > 0 && months < horizon && after === null) return null;
      if (device > 0 && deviceMonths === null) return null;
      const service =
        months === 0 || months >= horizon
          ? base * horizon
          : base * months + after! * (horizon - months);
      return service + activation + device * Math.min(horizon, deviceMonths ?? 0);
    };
    current = amount('Current', 12);
    candidate = amount('Quote', 12);
    const current24 = amount('Current', 24);
    const candidate24 = amount('Quote', 24);
    if (current24 !== null && candidate24 !== null)
      next24 = { current: current24, candidate: candidate24, difference: current24 - candidate24 };
    if (current === null || candidate === null)
      reasons.push(
        'Conferma canoni, durata promozioni, attivazione e rate apparati per entrambi (inserisci 0 se assenti).',
      );
    notes.push('Copertura e prestazioni all’indirizzo restano da verificare.');
    if (read('exitCurrent') === null)
      notes.push(
        'Il costo di recesso dal contratto attuale non è confermato e non è incluso nella differenza.',
      );
  } else {
    if (!match('coverage')) reasons.push('Conferma la stessa garanzia principale.');
    if (fields.limitCurrent?.confirmed || fields.limitQuote?.confirmed) {
      if (read('limitCurrent') !== read('limitQuote'))
        reasons.push('I massimali sono diversi o incompleti.');
    }
    if (fields.deductibleCurrent?.confirmed || fields.deductibleQuote?.confirmed) {
      if (read('deductibleCurrent') !== read('deductibleQuote'))
        reasons.push('Le franchigie sono diverse o incomplete.');
    }
    current = positive('premiumCurrent');
    candidate = positive('premiumQuote');
    const quoteExpiry = date(fields.expiryQuote);
    if (quoteExpiry && quoteExpiry < new Date()) reasons.push('Il preventivo è scaduto.');
    if (current === null || candidate === null)
      reasons.push('Servono premi annui personali confermati.');
    notes.push('Verifica anche esclusioni, rivalse e garanzie accessorie nei documenti originali.');
  }
  if (reasons.length)
    return {
      status: Object.values(fields).some((field) => field.confirmed) ? 'partial' : 'unavailable',
      reasons,
      current,
      candidate,
      period,
      difference: null,
      notes,
    };
  return {
    status: 'comparable',
    reasons,
    current,
    candidate,
    period,
    difference: current! - candidate!,
    notes,
    next24,
    electricityBreakdown,
  };
}
