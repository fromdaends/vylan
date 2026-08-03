// The statement document. Same visual language as the invoice PDF on purpose:
// identity band with the firm's brand colour as a thin accent, a hairline
// table, right-aligned totals. A client who has received invoices from this
// firm should recognise the statement as coming from the same people.
//
// Pure function of the StatementModel, exactly like ./pdf.tsx.

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
  STATEMENT_LABELS,
  statementPeriodLabel,
  statementStatusLabel,
  pdfMoney,
  pdfDate,
  type StatementModel,
} from "./statement-model";

const INK = "#0f172a";
const MUTED = "#64748b";
const HAIRLINE = "#e2e8f0";
const DANGER = "#b91c1c";

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
  subtitle: { color: MUTED, marginTop: 3, fontSize: 10.5 },
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
  billToRow: { marginBottom: 24 },
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
  colInvoice: { width: 92, paddingRight: 6 },
  colIssued: { width: 78, paddingRight: 6 },
  colEngagement: { flex: 1, paddingRight: 6 },
  colMoney: { width: 66, textAlign: "right" },
  colStatus: { width: 58, textAlign: "right" },
  overdueText: { color: DANGER },
  engagementText: { color: MUTED, fontSize: 9 },
  totals: { marginTop: 14, alignSelf: "flex-end", width: 260 },
  totalLine: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 3.5,
  },
  totalLabel: { color: MUTED },
  grandTotal: {
    flexDirection: "row",
    justifyContent: "space-between",
    borderTopWidth: 1.5,
    marginTop: 4,
    paddingTop: 7,
  },
  grandTotalText: { fontSize: 12.5, fontFamily: "Helvetica-Bold" },
  settled: { marginTop: 26, fontSize: 10, color: MUTED },
  empty: { marginTop: 26, fontSize: 10, color: MUTED },
});

function StatementDocument({ model }: { model: StatementModel }) {
  const L = STATEMENT_LABELS[model.language];
  const lang = model.language;

  return (
    <Document title={L.title}>
      <Page size="LETTER" style={styles.page}>
        <View style={styles.headerRow}>
          <View>
            {model.logoDataUri ? (
              <Image src={model.logoDataUri} style={styles.logo} />
            ) : (
              <Text style={styles.firmName}>{model.firmName}</Text>
            )}
          </View>
          <View style={styles.firmMeta}>
            {model.logoDataUri ? (
              <Text style={{ color: INK, fontFamily: "Helvetica-Bold" }}>
                {model.firmName}
              </Text>
            ) : null}
            {model.firmAddressLines.map((line, i) => (
              <Text key={i}>{line}</Text>
            ))}
            {model.firmContactLine ? (
              <Text>{model.firmContactLine}</Text>
            ) : null}
          </View>
        </View>

        <View style={[styles.accent, { backgroundColor: model.brandColor }]} />

        <View style={styles.titleRow}>
          <View>
            <Text style={styles.title}>{L.title}</Text>
            <Text style={styles.subtitle}>{statementPeriodLabel(model)}</Text>
          </View>
          <View style={styles.metaBlock}>
            <Text style={styles.metaLabel}>{L.generated}</Text>
            <Text>{pdfDate(model.generatedOn, lang)}</Text>
          </View>
        </View>

        <View style={styles.billToRow}>
          <Text style={styles.billToLabel}>{L.forClient}</Text>
          <Text style={styles.billToName}>{model.clientName}</Text>
        </View>

        {model.lines.length === 0 ? (
          <Text style={styles.empty}>{L.empty}</Text>
        ) : (
          <>
            <View style={styles.tableHeader}>
              <Text style={[styles.th, styles.colInvoice]}>{L.invoice}</Text>
              <Text style={[styles.th, styles.colIssued]}>{L.issued}</Text>
              <Text style={[styles.th, styles.colEngagement]}>
                {L.due}
              </Text>
              <Text style={[styles.th, styles.colMoney]}>{L.total}</Text>
              <Text style={[styles.th, styles.colMoney]}>{L.paid}</Text>
              <Text style={[styles.th, styles.colMoney]}>{L.owing}</Text>
              <Text style={[styles.th, styles.colStatus]}>{L.status}</Text>
            </View>

            {model.lines.map((line, i) => {
              const overdue = line.status === "overdue";
              return (
                <View key={i} style={styles.row} wrap={false}>
                  <Text style={styles.colInvoice}>
                    {line.invoiceNumber ?? "—"}
                  </Text>
                  <Text style={styles.colIssued}>
                    {pdfDate(line.issuedOn, lang)}
                  </Text>
                  <View style={styles.colEngagement}>
                    <Text style={overdue ? styles.overdueText : undefined}>
                      {line.dueDate ? pdfDate(line.dueDate, lang) : "—"}
                    </Text>
                    {line.engagementTitle ? (
                      <Text style={styles.engagementText}>
                        {line.engagementTitle}
                      </Text>
                    ) : null}
                  </View>
                  <Text style={styles.colMoney}>
                    {pdfMoney(line.totalCents, lang)}
                  </Text>
                  <Text style={styles.colMoney}>
                    {pdfMoney(line.paidCents, lang)}
                  </Text>
                  <Text
                    style={[
                      styles.colMoney,
                      ...(overdue ? [styles.overdueText] : []),
                    ]}
                  >
                    {pdfMoney(line.outstandingCents, lang)}
                  </Text>
                  <Text
                    style={[
                      styles.colStatus,
                      ...(overdue ? [styles.overdueText] : []),
                    ]}
                  >
                    {statementStatusLabel(line.status, lang)}
                  </Text>
                </View>
              );
            })}

            <View style={styles.totals}>
              <View style={styles.totalLine}>
                <Text style={styles.totalLabel}>{L.totalBilled}</Text>
                <Text>{pdfMoney(model.totalBilledCents, lang)}</Text>
              </View>
              <View style={styles.totalLine}>
                <Text style={styles.totalLabel}>{L.totalPaid}</Text>
                <Text>{pdfMoney(model.totalPaidCents, lang)}</Text>
              </View>
              <View
                style={[styles.grandTotal, { borderTopColor: model.brandColor }]}
              >
                <Text style={styles.grandTotalText}>{L.totalOwing}</Text>
                <Text style={styles.grandTotalText}>
                  {pdfMoney(model.totalOwingCents, lang)}
                </Text>
              </View>
            </View>

            {/* The nicest line on the page, and the one worth printing: a
                client who owes nothing should be told so, not left to add up
                a column of zeroes. */}
            {model.totalOwingCents === 0 && (
              <Text style={styles.settled}>{L.nothingOwed}</Text>
            )}
          </>
        )}
      </Page>
    </Document>
  );
}

export async function renderStatementPdf(
  model: StatementModel,
): Promise<Buffer> {
  return renderToBuffer(<StatementDocument model={model} />);
}
