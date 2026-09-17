/* RemedyBridge.java — JDBC bridge for the CST Escalations connector (17 Sep 2026).
 *
 * Why a bridge and not a Node driver: 152 has no internet, so every dependency is shipped by hand. The Node route
 * (mssql → tedious) hard-requires the @azure/identity tree even for SQL authentication — 67 MB into
 * server/node_modules — while Microsoft's JDBC driver is a single 1.5 MB jar beside the ojdbc11 that the Arqami
 * bridge already uses. Same pattern, same protocol, one more small JVM.
 *
 * Protocol (identical to ArqamiBridge — one request per line on stdin, one JSON answer per line on stdout):
 *   <id> TAB <base64 sql, ? placeholders> [TAB <bind>]*      bind = "s:" + base64(text) | "n:" + number | "null"
 *   → {"id":<id>,"ms":<n>,"rows":[{"COL":value,...}]}         numbers as numbers, dates as "YYYY-MM-DD HH:MM:SS", else strings
 *   → {"id":<id>,"error":"..."}                                the connection is re-opened on the next request after a failure
 *
 * PROD SAFETY — this is the live Remedy AR System database:
 *   · SELECT / WITH only. Anything else is refused here, before it reaches SQL Server.
 *   · The session is READ ONLY and runs at READ UNCOMMITTED (CST_REMEDY_NOLOCK=0 turns that off): a reporting
 *     query must never take shared locks on the tables the Remedy application is writing to. Dirty reads are
 *     acceptable for a troubleshooting console; blocking Remedy is not.
 *   · Every statement carries a query timeout (CST_REMEDY_QUERY_SECS, default 60) and a fetch size, so a bad
 *     query dies on the server instead of streaming a whole view into the JVM.
 * Credentials come from the environment (CST_REMEDY_*) — never on the command line, never logged.
 * CST_REMEDY_JDBC_URL replaces the whole URL when the DBA needs a shape this does not build (named instance,
 * failover partner); it is also what lets the bridge be tested against a throwaway database before it is ever
 * pointed at Remedy. */
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.sql.*;
import java.util.*;

public class RemedyBridge {
  static Connection conn;
  static String url, user, pass;
  static boolean nolock = true;
  static int querySecs = 60;

  public static void main(String[] a) throws Exception {
    Map<String, String> E = System.getenv();
    String host = E.getOrDefault("CST_REMEDY_HOST", ""), port = E.getOrDefault("CST_REMEDY_PORT", "1433");
    String dbase = E.getOrDefault("CST_REMEDY_DATABASE", "ARSystem"), extra = E.getOrDefault("CST_REMEDY_JDBC_EXTRA", "");
    user = E.getOrDefault("CST_REMEDY_USER", ""); pass = E.getOrDefault("CST_REMEDY_PASSWORD", "");
    nolock = !"0".equals(E.getOrDefault("CST_REMEDY_NOLOCK", "1"));
    try { querySecs = Integer.parseInt(E.getOrDefault("CST_REMEDY_QUERY_SECS", "60")); } catch (Exception ignore) {}
    /* encrypt=false + trustServerCertificate: an older SQL Server behind a JDBC 12 driver otherwise fails the
     * handshake outright. Anything else the DBA needs (instanceName, integratedSecurity, TLS overrides) goes in
     * CST_REMEDY_JDBC_EXTRA verbatim and is appended last, so it can override what is set here. */
    String override = E.getOrDefault("CST_REMEDY_JDBC_URL", "");
    url = !override.isEmpty() ? override                      // whole URL from the DBA (named instance, failover partner, …)
        : "jdbc:sqlserver://" + host + ":" + port + ";databaseName=" + dbase
        + ";encrypt=false;trustServerCertificate=true;loginTimeout=10;socketTimeout=180000;applicationName=SalamOpsConsole"
        + (extra.isEmpty() ? "" : (extra.startsWith(";") ? extra : ";" + extra));
    BufferedReader in = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8));
    PrintStream out = new PrintStream(new FileOutputStream(FileDescriptor.out), true, "UTF-8");
    out.println("{\"ready\":true,\"url\":\"" + esc(url) + "\",\"java\":\"" + esc(System.getProperty("java.version"))
        + "\",\"nolock\":" + nolock + ",\"querySecs\":" + querySecs + "}");
    String line;
    while ((line = in.readLine()) != null) {
      if (line.isEmpty()) continue;
      String[] p = line.split("\t");
      String id = p[0];
      long t0 = System.currentTimeMillis();
      try {
        String sql = new String(Base64.getDecoder().decode(p[1]), StandardCharsets.UTF_8);
        String head = sql.trim().toUpperCase(Locale.ROOT);
        if (!(head.startsWith("SELECT") || head.startsWith("WITH"))) throw new SQLException("only SELECT statements are allowed through the bridge");
        out.println(run(id, sql, Arrays.copyOfRange(p, 2, p.length), t0));
      } catch (Throwable e) {
        closeQuietly();
        out.println("{\"id\":\"" + esc(id) + "\",\"error\":\"" + esc(String.valueOf(e.getMessage()).trim()) + "\"}");
      }
    }
  }

  static Connection get() throws SQLException {
    if (conn != null) { try { if (conn.isValid(3)) return conn; } catch (SQLException ignore) {} closeQuietly(); }
    Properties pr = new Properties();
    pr.put("user", user); pr.put("password", pass);
    conn = DriverManager.getConnection(url, pr);
    conn.setAutoCommit(true);
    try { conn.setReadOnly(true); } catch (SQLException ignore) { /* a hint only on SQL Server */ }
    if (nolock && url.startsWith("jdbc:sqlserver:")) try (Statement s = conn.createStatement()) { s.execute("SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED"); }
    return conn;
  }
  static void closeQuietly() { try { if (conn != null) conn.close(); } catch (Throwable ignore) {} conn = null; }

  static String run(String id, String sql, String[] binds, long t0) throws SQLException {
    Connection c = get();
    try (PreparedStatement ps = c.prepareStatement(sql)) {
      ps.setFetchSize(500);
      ps.setQueryTimeout(querySecs);
      for (int i = 0; i < binds.length; i++) {
        String b = binds[i];
        if (b.equals("null")) ps.setNull(i + 1, Types.NVARCHAR);
        else if (b.startsWith("n:")) ps.setDouble(i + 1, Double.parseDouble(b.substring(2)));
        else ps.setString(i + 1, new String(Base64.getDecoder().decode(b.substring(2)), StandardCharsets.UTF_8));
      }
      try (ResultSet rs = ps.executeQuery()) {
        ResultSetMetaData m = rs.getMetaData(); int n = m.getColumnCount();
        String[] names = new String[n];
        for (int i = 0; i < n; i++) names[i] = m.getColumnLabel(i + 1).toUpperCase(Locale.ROOT);
        StringBuilder sb = new StringBuilder(4096);
        sb.append("{\"id\":\"").append(esc(id)).append("\",\"rows\":[");
        boolean first = true;
        while (rs.next()) {
          if (!first) sb.append(','); first = false;
          sb.append('{');
          for (int i = 0; i < n; i++) {
            if (i > 0) sb.append(',');
            sb.append('"').append(esc(names[i])).append("\":");
            Object v = rs.getObject(i + 1);
            if (v == null) sb.append("null");
            else if (v instanceof Number) { String s = v.toString(); sb.append(s.matches("-?\\d+(\\.\\d+)?(E-?\\d+)?") ? s : '"' + esc(s) + '"'); }
            else if (v instanceof Boolean) sb.append(((Boolean) v) ? "true" : "false");
            else if (v instanceof java.sql.Timestamp || v instanceof java.sql.Date || v instanceof java.util.Date) { Timestamp ts = rs.getTimestamp(i + 1); sb.append('"').append(ts == null ? "" : ts.toString().substring(0, 19)).append('"'); }
            else sb.append('"').append(esc(rs.getString(i + 1))).append('"');
          }
          sb.append('}');
        }
        sb.append("],\"ms\":").append(System.currentTimeMillis() - t0).append('}');
        return sb.toString();
      }
    }
  }

  static String esc(String s) {
    if (s == null) return "";
    StringBuilder b = new StringBuilder(s.length() + 8);
    for (int i = 0; i < s.length(); i++) {
      char ch = s.charAt(i);
      switch (ch) {
        case '"': b.append("\\\""); break; case '\\': b.append("\\\\"); break;
        case '\n': b.append("\\n"); break; case '\r': b.append("\\r"); break; case '\t': b.append("\\t"); break;
        default: if (ch < 0x20) b.append(String.format("\\u%04x", (int) ch)); else b.append(ch);
      }
    }
    return b.toString();
  }
}
