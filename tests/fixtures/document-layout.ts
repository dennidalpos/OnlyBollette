// Synthetic fixture only.
export const word = (text: string, x: number, y: number, width = text.length * 10) => ({
  text,
  x,
  y,
  width,
  height: 20,
});

export const componentBlocks = () => ({
  fileName: 'synthetic-component-blocks.pdf',
  readable: true,
  pages: [
    {
      number: 8,
      text: '',
      lines: [
        ...[
          ['Commercializzazione e vendita - parte fissa', 'euro/pdp/mese', '9,12345678', '2'],
          ['Componente di dispacciamento (parte fissa)', 'euro/pdp/mese', '0,23456789', '2'],
          ['Corrispettivo Energia', 'euro/kWh', '0,14567890', '200'],
          ['Perdite su Corrispettivo Energia', 'euro/kWh', '0,14567890', '19'],
          ['Dispacciamento', 'euro/kWh', '0,02345678', '200'],
          ['Quota energia', 'euro/kWh', '0,00987654', '200'],
        ].flatMap(([label, unit, price, quantity], index) => {
          const y = 40 + index * 160;
          return [
            {
              words: [
                word(label, 40, y),
                word('tipo prezzo', 600, y),
                word('prezzo', 850, y),
                word('quantità', 1100, y),
                word('euro', 1350, y),
              ],
            },
            ...['DAL 01/05/2026 AL 31/05/2026', 'DAL 01/06/2026 AL 30/06/2026'].map(
              (period, offset) => ({
                words: [
                  word(period, 40, y + 40 + offset * 40),
                  word(unit, 600, y + 40 + offset * 40),
                  word(price, 850, y + 40 + offset * 40),
                  word(quantity, 1100, y + 40 + offset * 40),
                  word('29,14', 1350, y + 40 + offset * 40),
                ],
              }),
            ),
          ];
        }),
      ],
    },
  ],
});

export const layoutBill = {
  fileName: 'synthetic-layout.png',
  readable: true,
  pages: [
    {
      number: 2,
      text: 'Flattened text must not be used when geometry is available.',
      lines: [
        {
          words: [word('Condizioni contrattuali', 40, 40), word('Informazioni generali', 800, 40)],
        },
        {
          words: [
            word('Recesso con preavviso', 40, 70),
            word('Importo da pagare 99 euro', 800, 70),
          ],
        },
        { words: [word('di trenta giorni.', 40, 100), word('Totale storico 800 euro', 800, 100)] },
        {
          words: [
            word('Componente energia', 40, 200),
            word('0,12 euro/kWh', 400, 200),
            word('Informazioni estranee', 800, 200),
          ],
        },
      ],
    },
  ],
};

export const profileBill = {
  fileName: 'synthetic-profile.png',
  readable: true,
  pages: [
    {
      number: 3,
      text: 'Informazioni generali: cliente domestico residente. Tariffa bioraria.',
      lines: [
        { words: [word('Dati della fornitura', 40, 40), word('Informazioni generali', 1008, 40)] },
        {
          words: [
            word('Tipologia cliente', 40, 80),
            word('Domestico non residente', 600, 80),
            word('Cliente domestico residente', 1000, 80),
          ],
        },
        {
          words: [
            word('Potenza impegnata', 40, 120),
            word('4,5 kW', 600, 120),
            word('Tariffa bioraria', 1000, 120),
          ],
        },
        { words: [word('Tipologia tariffa', 40, 160), word('Monoraria', 600, 160)] },
        { words: [word('Consumi', 40, 260)] },
        { words: [word('Consumo annuo', 40, 300)] },
        { words: [word('dal 01/01/2025 al 31/12/2025', 40, 330)] },
        { words: [word('3.120 kWh', 40, 360)] },
        { words: [word('Consumo fatturato 250 kWh', 40, 430)] },
        { words: [word('F1 1.100 kWh F2 1.020 kWh F3 1.000 kWh', 40, 470)] },
      ],
    },
  ],
};
