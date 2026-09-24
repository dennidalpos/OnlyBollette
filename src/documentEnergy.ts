import type { DocumentWord } from './comparisonDocuments';

export interface ComponentValue {
  key: string;
  value: string;
  period?: string;
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
  const add = (key: string, value: string, period?: string) => values.push({ key, value, period });
  for (const row of rows) {
    let text = row.text;
    let period: string | undefined;
    const header = headers.filter((item) => item.y < row.y).sort((a, b) => b.y - a.y)[0];
    const kind =
      /^(?:componente energia|prezzo (?:della )?materia energia|prezzo (?:di )?vendita)\b/i.test(
        text,
      )
        ? 'unit'
        : /^(?:quota fissa (?:di )?vendita|commercializzazione vendita|corrispettivo fisso vendita)\b/i.test(
              text,
            )
          ? 'fixed'
          : /^dispacciamento\b/i.test(text)
            ? 'dispatchUnit'
            : /^DISPbt\b/i.test(text)
              ? 'commercialAnnual'
              : undefined;
    if (kind && header) {
      const columns = rows.filter((item) => sameRow(item, header)).sort((a, b) => a.x - b.x);
      const get = (pattern: RegExp) => {
        const index = columns.findIndex((item) => pattern.test(item.text));
        if (index < 0) return undefined;
        const column = columns[index];
        const next = columns[index + 1];
        const cells = words.filter(
          (item) =>
            sameRow(item, row) &&
            item !== row &&
            item.x >= column.x - column.height &&
            (!next || item.x < next.x - next.height),
        );
        return cells.length
          ? cells
              .sort((a, b) => a.x - b.x)
              .map((cell) => cell.text)
              .join(' ')
          : undefined;
      };
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
      if (rate) {
        if ((kind === 'unit' || kind === 'dispatchUnit') && /^kWh$/i.test(rate[2])) {
          add(kind, rate[1], period);
          if (kind === 'dispatchUnit') add('dispatchMode', 'separato', period);
        }
        if ((kind === 'fixed' || kind === 'commercialAnnual') && /^(mese|anno)$/i.test(rate[2])) {
          add(
            kind,
            /^mese$/i.test(rate[2])
              ? String(Number((Number(rate[1].replace(',', '.')) * 12).toFixed(8))).replace(
                  '.',
                  ',',
                )
              : rate[1],
            period,
          );
          if (kind === 'commercialAnnual') add('commercialMode', 'separata', period);
        }
      }
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
