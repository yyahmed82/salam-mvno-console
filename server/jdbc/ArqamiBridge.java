/* ArqamiBridge.java — tiny JDBC bridge for the Arqami connector (16 Sep 2026).
 *
 * Why: EBPROD is Oracle 9i (9.2.0.6). No current native Oracle client connects to it any more (node-oracledb thin needs
 * 12.1+, Instant Client 21/23 need 11.2.0.4+, and the 11.2 client is no longer a public download) — but Oracle's Java
 * driver still does, which is how DBeaver reaches it. So the console keeps one long-lived JVM beside the Node process and
 * sends it the same read-only SELECTs over stdin / stdout.
 *
 * Protocol (one request per line on stdin, one JSON answer per line on stdout):
 *   <id> TAB <base64 sql, ? placeholders> [TAB <bind>]*      bind = "s:" + base64(text) | "n:" + number | "null"
 *   → {"id":<id>,"ms":<n>,"rows":[{"COL":value,...}]}         numbers as numbers, dates as "YYYY-MM-DD HH:MM:SS", else strings
 *   → {"id":<id>,"error":"..."}                                the connection is re-opened on the next request after a failure
 * Credentials come from the environment (CST_ORACLE_HOST / PORT / SERVICE / USER / PASSWORD) — never on the command line.
 * Only SELECT / WITH statements are accepted; anything else is refused before it reaches Oracle. */
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.sql.*;
import java.util.*;

public class ArqamiBridge {
  static Connection conn;
  static String url, user, pass;

  public static void main(String[] a) throws Exception {
    Map<String, String> E = System.getenv();
    String host = E.getOrDefault("CST_ORACLE_HOST", ""), port = E.getOrDefault("CST_ORACLE_PORT", "1521"), svc = E.getOrDefault("CST_ORACLE_SERVICE", "");
    user = E.getOrDefault("CST_ORACLE_USER", ""); pass = E.getOrDefault("CST_ORACLE_PASSWORD", "");
    boolean sid = "sid".equalsIgnoreCase(E.getOrDefault("CST_ORACLE_CONNECT", "service"));
    url = sid ? "jdbc:oracle:thin:@" + host + ":" + port + ":" + svc : "jdbc:oracle:thin:@//" + host + ":" + port + "/" + svc;
    System.setProperty("oracle.net.disableOob", "true");
    System.setProperty("oracle.jdbc.timezoneAsRegion", "false");
    BufferedReader in = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8));
    PrintStream out = new PrintStream(new FileOutputStream(FileDescriptor.out), true, "UTF-8");
    out.println("{\"ready\":true,\"url\":\"" + esc(url.replace(pass, "***")) + "\",\"java\":\"" + esc(System.getProperty("java.version")) + "\"}");
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
    pr.put("oracle.net.CONNECT_TIMEOUT", "10000"); pr.put("oracle.jdbc.ReadTimeout", "180000");
    conn = DriverManager.getConnection(url, pr);
    conn.setReadOnly(true); conn.setAutoCommit(true);
    return conn;
  }
  static void closeQuietly() { try { if (conn != null) conn.close(); } catch (Throwable ignore) {} conn = null; }

  static String run(String id, String sql, String[] binds, long t0) throws SQLException {
    Connection c = get();
    try (PreparedStatement ps = c.prepareStatement(sql)) {
      ps.setFetchSize(500);
      for (int i = 0; i < binds.length; i++) {
        String b = binds[i];
        if (b.equals("null")) ps.setNull(i + 1, Types.VARCHAR);
        else if (b.startsWith("n:")) ps.setDouble(i + 1, Double.parseDouble(b.substring(2)));
        else ps.setString(i + 1, new String(Base64.getDecoder().decode(b.substring(2)), StandardCharsets.UTF_8));
      }
      try (ResultSet rs = ps.executeQuery()) {
        ResultSetMetaData m = rs.getMetaData(); int n = m.getColumnCount();
        String[] names = new String[n]; int[] types = new int[n];
        for (int i = 0; i < n; i++) { names[i] = m.getColumnLabel(i + 1).toUpperCase(Locale.ROOT); types[i] = m.getColumnType(i + 1); }
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
