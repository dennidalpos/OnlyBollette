import type { DocumentWord } from './comparisonDocuments';

export interface ComponentValue {
  key: string;
  value: string | null;
  period?: string;
}

function componentKind(text: string) {
  if (
    /^(?:componente energia|corrispettivo energia|prezzo (?:della )?materia energia|prezzo (?:di )?vendita)\b/i.test(
      text,
    )
  )
    return 'unit';
  if (
    /^(?:quota fissa (?:di )?vendita|commercializzazione (?:e )?vendita(?:\s*-\s*parte fissa)?|corrispettivo fisso vendita)\b/i.test(
      text,
    )
  )
    return 'fixed';
  if (/^dispacciamento\b/i.test(text)) return 'dispatchUnit';
  if (/^DISPbt\b/i.test(text)) return 'commercialAnnual';
}

export function energyComponents(
  rows: DocumentWord[],
  words: DocumentWord[] = rows,
): ComponentValue[] {
  const values: ComponentValue[] = [];
  const amount = '(\\d+(?:[.,]\\d+)?)';
  const sameRow = (a: DocumentWord, b: DocumentWord) =>
    Math.abs(a.y + a.height / 2 - b.y - b.height / 2) < Math.max(a.height, b.height) / 2;
  const headers = rows.filter((row) => /^prezzo unitario$/i.test(row.text));
  const add = (key: string, value: string | null, period?: string) =>
    values.push({ key, value, period });
  const rateValue = (kind: string, price: string, unit: string, period?: string) => {
    if ((kind === 'unit' || kind === 'dispatchUnit') && /^kWh$/i.test(unit)) {
      add(kind, price, period);
      if (kind === 'dispatchUnit') add('dispatchMode', 'separato', period);
      return true;
    }
    if ((kind === 'fixed' || kind === 'commercialAnnual') && /^(mese|anno)$/i.test(unit)) {
      add(
        kind,
        /^mese$/i.test(unit)
          ? String(Number((Number(price.replace(',', '.')) * 12).toFixed(8))).replace('.', ',')
          : price,
        period,
      );
      if (kind === 'commercialAnnual') add('commercialMode', 'separata', period);
      return true;
    }
    return false;
  };
  const columnValue = (
    columns: DocumentWord[],
    row: DocumentWord,
    pattern: RegExp,
    centered = false,
  ) => {
    const index = columns.findIndex((item) => pattern.test(item.text));
    if (index < 0) return undefined;
    const column = columns[index];
    const previous = columns[index - 1];
    const next = columns[index + 1];
    const left =
      centered && previous
        ? (previous.x + previous.width + column.x) / 2
        : column.x - column.height;
    const right = next
      ? centered
        ? (column.x + column.width + next.x) / 2
        : next.x - next.height
      : Infinity;
    const cells = words.filter(
      (item) => sameRow(item, row) && item !== row && item.x >= left && item.x < right,
    );
    return cells.length
      ? cells
          .sort((a, b) => a.x - b.x)
          .map((cell) => cell.text)
          .join(' ')
      : undefined;
  };
  // Header owns following period rows.
  for (const header of rows.filter((row) => /^tipo prezzo$/i.test(row.text))) {
    const columns = rows.filter((row) => sameRow(row, header)).sort((a, b) => a.x - b.x);
    const label = columns[0];
    const kind = componentKind(label.text);
    if (
      !kind ||
      /\b(?:F[123]|F23|fascia|medio)\b/i.test(label.text) ||
      !columns.some((row) => /^prezzo$/i.test(row.text)) ||
      !columns.some((row) => /^(?:quantit[aà]|kWh)$/i.test(row.text))
    )
      continue;
    const following = rows
      .filter(
        (row) => row.y > header.y + header.height / 2 && Math.abs(row.x - label.x) <= label.height,
      )
      .sort((a, b) => a.y - b.y);
    let previous = header;
    for (const row of following) {
      if (row.y - previous.y > 3 * Math.max(row.height, previous.height)) break;
      if (
        !/^(?:dal\s+)?\d{2}[/.]\d{2}[/.]\d{4}\s*(?:al|-)\s*\d{2}[/.]\d{2}[/.]\d{4}$/i.test(row.text)
      ) {
        if (/^(?:dal\b|\d)/i.test(row.text)) add(kind, null, row.text);
        break;
      }
      previous = row;
      const price = columnValue(columns, row, /^prezzo$/i, true)?.replace(/([.,])\s+(?=\d)/g, '$1');
      const unit = columnValue(columns, row, /^tipo prezzo$/i, true)
        ?.replace(/\s/g, '')
        .match(/^(?:€|euro)\/(?:pdp\/)?(kWh|mese|anno)$/i)?.[1];
      if (
        !price ||
        !/^\d+(?:[.,]\d+)?$/.test(price) ||
        !unit ||
        !rateValue(kind, price, unit, row.text)
      )
        add(kind, null, row.text);
    }
  }
  for (const row of rows) {
    let text = row.text;
    let period: string | undefined;
    const header = headers.filter((item) => item.y < row.y).sort((a, b) => b.y - a.y)[0];
    const kind = componentKind(text);
    if (kind && header) {
      const columns = rows.filter((item) => sameRow(item, header)).sort((a, b) => a.x - b.x);
      const get = (pattern: RegExp) => columnValue(columns, row, pattern);
      const rawPrice = get(/^prezzo unitario$/i);
      const price = rawPrice?.replace(/([.,])\s+(?=\d)/g, '$1');
      const unit = get(/^unit[aà](?: di misura)?$/i);
      period = get(/^periodo$/i);
      if (price && unit && period && /^\d+(?:[.,]\d+)?$/.test(price)) text += ` ${price} ${unit}`;
    }
    if (kind && !/\b(?:F[123]|F23|fascia|medio)\b/i.test(text)) {
      const rate = text.match(
        new RegExp(
          `^(?:componente energia|prezzo (?:della )?materia energia|prezzo (?:di )?vendita|quota fissa (?:di )?vendita|commercializzazione vendita|corrispettivo fisso vendita|dispacciamento|DISPbt)\\s*:?\\s*${amount}\\s*(?:€|euro)\\s*\\/\\s*(kWh|mese|anno)\\b`,
          'i',
        ),
      );
      if (rate) rateValue(kind, rate[1], rate[2], period);
    }
    const losses = text.match(/\bperdite(?: di rete)?\s+(incluse|escluse)\b/i);
    if (losses) add('losses', losses[1].toLowerCase());
    const percent = text.match(new RegExp(`perdite(?: di rete)?\\s+${amount}\\s*%`, 'i'));
    if (percent) add('lossPercent', percent[1]);
    const dispatch = text.match(/\bdispacciamento\s+(incluso|separato|parametro ufficiale)\b/i);
    if (dispatch) add('dispatchMode', dispatch[1].toLowerCase());
    const commercial = text.match(/\bDISPbt\s+(inclusa|separata|parametro ufficiale)\b/i);
    if (commercial) add('commercialMode', commercial[1].toLowerCase());
  }
  return values;
}
