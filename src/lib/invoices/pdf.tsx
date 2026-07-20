// The invoice document itself — @react-pdf/renderer, rendered server-side on
// demand (routes) and once at the paid flip (freeze). Pure function of the
// InvoicePdfModel: same model in, same PDF out. Layout: minimal and sharp —
// identity band with the firm's brand color as a thin accent, Bill-to +
// number/dates, the line table, right-aligned totals with one labelled line
// per tax (registration number underneath), terms/notes at the foot.

import {
  Document,
  Image,
  Page,
  StyleSheet,
  Text,
  View,
  renderToBuffer,
} from "@react-pdf/renderer";
import {
  PDF_LABELS,
  lineDescriptionForDisplay,
  pdfDate,
  pdfMoney,
  pdfQuantity,
  taxLineLabel,
  type InvoicePdfModel,
} from "./pdf-model";

const INK = "#0f172a";
const MUTED = "#64748b";
const HAIRLINE = "#e2e8f0";

const styles = StyleSheet.create({
  page: {
    paddingTop: 48,
    paddingBottom: 56,
    paddingHorizontal: 52,
    fontFamily: "Helvetica",
    fontSize: 10,
    color: INK,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  logo: { maxHeight: 42, maxWidth: 120, objectFit: "contain" },
  firmName: { fontSize: 15, fontFamily: "Helvetica-Bold" },
  firmMeta: { textAlign: "right", color: MUTED, fontSize: 9, lineHeight: 1.45 },
  accent: { height: 2, marginTop: 14, marginBottom: 22 },
  titleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    marginBottom: 20,
  },
  title: { fontSize: 21, fontFamily: "Helvetica-Bold", letterSpacing: 1 },
  invoiceNumber: { color: MUTED, marginTop: 3, fontSize: 10.5 },
  paidBadge: {
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
    letterSpacing: 1,
    borderWidth: 1,
    borderRadius: 3,
    paddingVertical: 3,
    paddingHorizontal: 8,
    alignSelf: "flex-end",
  },
  metaBlock: { textAlign: "right", fontSize: 9.5, lineHeight: 1.5 },
  metaLabel: { color: MUTED },
  billToLabel: {
    fontSize: 8.5,
    color: MUTED,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginBottom: 3,
  },
  billToName: { fontSize: 11.5, fontFamily: "Helvetica-Bold" },
  billToRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    marginBottom: 24,
  },
  tableHeader: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: INK,
    paddingBottom: 5,
    marginBottom: 2,
  },
  th: {
    fontSize: 8.5,
    fontFamily: "Helvetica-Bold",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    color: MUTED,
  },
  row: {
    flexDirection: "row",
    borderBottomWidth: 0.5,
    borderBottomColor: HAIRLINE,
    paddingVertical: 7,
  },
  colDesc: { flex: 1, paddingRight: 8 },
  colQty: { width: 44, textAlign: "right" },
  colRate: { width: 72, textAlign: "right" },
  colAmount: { width: 84, textAlign: "right" },
  totals: { marginTop: 14, alignSelf: "flex-end", width: 260 },
  totalLine: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 3.5,
  },
  totalLabel: { color: MUTED },
  regNumber: { fontSize: 8, color: MUTED, marginTop: 1 },
  grandTotal: {
    flexDirection: "row",
    justifyContent: "space-between",
    borderTopWidth: 1.5,
    marginTop: 4,
    paddingTop: 7,
  },
  grandTotalText: { fontSize: 12.5, fontFamily: "Helvetica-Bold" },
  foot: { marginTop: 30, fontSize: 9, lineHeight: 1.5 },
  footLabel: {
    fontSize: 8.5,
    color: MUTED,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginBottom: 2,
  },
});

function InvoicePdfDocument({ model }: { model: InvoicePdfModel }) {
  const L = PDF_LABELS[model.language];
  return (
    <Document
      title={model.invoiceNumber ?? L.invoice}
      author={model.firmName}
      language={model.language}
    >
      <Page size="LETTER" style={styles.page}>
        {/* Identity band */}
        <View style={styles.headerRow}>
          <View>
            {model.logoDataUri ? (
              // eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image has no alt prop
              <Image src={model.logoDataUri} style={styles.logo} />
            ) : (
              <Text style={styles.firmName}>{model.firmName}</Text>
            )}
            {model.logoDataUri && (
              <Text style={[styles.firmName, { fontSize: 11, marginTop: 6 }]}>
                {model.firmName}
              </Text>
            )}
          </View>
          <View style={styles.firmMeta}>
            {model.firmAddressLines.map((line, i) => (
              <Text key={i}>{line}</Text>
            ))}
            {model.firmContactLine && <Text>{model.firmContactLine}</Text>}
          </View>
        </View>
        <View style={[styles.accent, { backgroundColor: model.brandColor }]} />

        {/* Title + number + paid stamp */}
        <View style={styles.titleRow}>
          <View>
            <Text style={styles.title}>{L.invoice}</Text>
            {model.invoiceNumber && (
              <Text style={styles.invoiceNumber}>{model.invoiceNumber}</Text>
            )}
          </View>
          {model.paid && (
            <Text
              style={[
                styles.paidBadge,
                { color: model.brandColor, borderColor: model.brandColor },
              ]}
            >
              {L.paid}
            </Text>
          )}
        </View>

        {/* Bill to + dates */}
        <View style={styles.billToRow}>
          <View>
            <Text style={styles.billToLabel}>{L.billTo}</Text>
            {model.clientName && (
              <Text style={styles.billToName}>{model.clientName}</Text>
            )}
            {model.engagementTitle && (
              <Text style={{ color: MUTED, marginTop: 2 }}>
                {L.engagement}: {model.engagementTitle}
              </Text>
            )}
          </View>
          <View style={styles.metaBlock}>
            {model.issueDate && (
              <Text>
                <Text style={styles.metaLabel}>{L.issueDate}: </Text>
                {pdfDate(model.issueDate, model.language)}
              </Text>
            )}
            {model.dueDate && (
              <Text>
                <Text style={styles.metaLabel}>{L.dueDate}: </Text>
                {pdfDate(model.dueDate, model.language)}
              </Text>
            )}
          </View>
        </View>

        {/* Line items */}
        <View style={styles.tableHeader}>
          <Text style={[styles.th, styles.colDesc]}>{L.description}</Text>
          <Text style={[styles.th, styles.colQty]}>{L.qty}</Text>
          <Text style={[styles.th, styles.colRate]}>{L.rate}</Text>
          <Text style={[styles.th, styles.colAmount]}>{L.amount}</Text>
        </View>
        {model.lines.map((line, i) => (
          <View key={i} style={styles.row} wrap={false}>
            <Text style={styles.colDesc}>
              {lineDescriptionForDisplay(line.description, model.language)}
            </Text>
            <Text style={styles.colQty}>
              {pdfQuantity(line.quantity, model.language)}
            </Text>
            <Text style={styles.colRate}>
              {pdfMoney(line.unit_cents, model.language)}
            </Text>
            <Text style={styles.colAmount}>
              {pdfMoney(line.amount_cents, model.language)}
            </Text>
          </View>
        ))}

        {/* Totals: subtotal, one labelled line per tax (with its registration
            number), then the brand-accented grand total. */}
        <View style={styles.totals}>
          <View style={styles.totalLine}>
            <Text style={styles.totalLabel}>{L.subtotal}</Text>
            <Text>{pdfMoney(model.subtotalCents, model.language)}</Text>
          </View>
          {model.taxLines.map((line) => (
            <View key={line.component} style={styles.totalLine}>
              <View>
                <Text style={styles.totalLabel}>
                  {taxLineLabel(line, model.language)}
                </Text>
                {line.registration_number && (
                  <Text style={styles.regNumber}>
                    {L.regNumber(line.registration_number)}
                  </Text>
                )}
              </View>
              <Text>{pdfMoney(line.amount_cents, model.language)}</Text>
            </View>
          ))}
          <View style={[styles.grandTotal, { borderTopColor: model.brandColor }]}>
            <Text style={styles.grandTotalText}>{L.total}</Text>
            <Text style={styles.grandTotalText}>
              {pdfMoney(model.totalCents, model.language)}
            </Text>
          </View>
        </View>

        {/* Terms + notes */}
        {(model.terms || model.notes) && (
          <View style={styles.foot}>
            {model.terms && (
              <View style={{ marginBottom: model.notes ? 8 : 0 }}>
                <Text style={styles.footLabel}>{L.terms}</Text>
                <Text>{model.terms}</Text>
              </View>
            )}
            {model.notes && (
              <View>
                <Text style={styles.footLabel}>{L.notes}</Text>
                <Text>{model.notes}</Text>
              </View>
            )}
          </View>
        )}
      </Page>
    </Document>
  );
}

export async function renderInvoicePdf(model: InvoicePdfModel): Promise<Buffer> {
  return Buffer.from(
    await renderToBuffer(<InvoicePdfDocument model={model} />),
  );
}
