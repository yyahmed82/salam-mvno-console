# RAILS RUNNER — release every IP held by the IpRetrial limiter.
#
# Runs ON AN API HOST (172.31.43.17 / .18), where selfcare-backend and its bundle live.
#
#   cd <app dir>
#   RAILS_ENV=production bundle exec rails runner /tmp/ip_flush.rb          # DRY RUN
#   APPLY=yes RAILS_ENV=production bundle exec rails runner /tmp/ip_flush.rb # delete
#
# WHY NOT JUST `Rails.cache.delete_matched("ip_address_retries_*")`
# That one-liner works, but it is silent: no count, no dry run, no way to see WHAT it is about to
# remove or how far it has got on a cache holding millions of keys. When the goal is "prove the
# blocks are gone", a number you can quote matters more than brevity. This does the same SCAN,
# shows its work, and refuses to delete unless APPLY=yes.
#
# WHY THE SETTINGS PRINTOUT AT THE TOP IS THE POINT
# The limiter reads Setting.* on every request. rails-settings-cached memoises, so a value edited
# in the admin UI can be live in the database and stale in this process. Printing the three values
# THROUGH THE SAME Setting CALL the limiter uses, on this host, is the only honest way to know
# whether the change took. If ip_elapse_time still reads 999999 here, flushing is pointless — the
# keys come straight back with an 11.6-day TTL.
#
# WHY FLUSHING IS MANDATORY, NOT TIDY-UP (concerns/ip_retrial.rb:29-41)
# update_cached_retries — the only writer of the TTL — sits INSIDE the allowed branch. A blocked
# request reads the key, returns -704, and never rewrites it. So a key written under the old
# elapse=999999 keeps that TTL for ~11.6 days no matter what the settings now say. Changing the
# setting fixes the FUTURE; only deleting the key fixes the PRESENT.
#
# Safety: PATTERN is a literal here and every key is re-checked against the prefix before it joins
# a DEL batch. SCAN (never KEYS — KEYS blocks single-threaded Redis for the whole sweep), batches
# of 200, a 10ms yield between batches.

APPLY   = ENV['APPLY'] == 'yes'
PREFIX  = 'ip_address_retries_'
PATTERN = PREFIX + '*'
BATCH   = 200
COUNT   = 500
ACTIONS = %w[validate_details_with_account validate_details voucher create confirm]

puts APPLY ? "IpRetrial flush — APPLY (keys will be deleted)"
           : "IpRetrial flush — DRY RUN (nothing deleted; set APPLY=yes to delete)"
puts

# ---- 1. what this PROCESS believes the settings are ----------------------------------------
puts "=== settings as THIS process sees them ==="
%w[ip_elapse_time ip_request_rate_limit ip_session_time].each do |k|
  v = (Setting.public_send(k) rescue "ERROR")
  puts format("  %-24s = %s", k, v)
end
puts "  ip_elapse_time is the key TTL. If it still reads 999999 here, the admin-UI change has not"
puts "  reached this process — restart the app servers before flushing, or blocks return at once."
puts

# ---- 2. the cache store -----------------------------------------------------------------------
store = Rails.cache
puts "=== cache store ==="
puts "  class     : #{store.class}"
ns = (store.options[:namespace] rescue nil)
puts "  namespace : #{ns.inspect}   <- must be nil; a namespace would prefix every key name"
abort("  ABORT: not a Redis cache store — nothing to scan.") unless store.respond_to?(:redis)
abort("  ABORT: cache has a namespace; the pattern above would miss every key.") if ns
puts

# ---- 3. sweep ---------------------------------------------------------------------------------
sweep = lambda do |c|
  t0 = Time.now
  total = 0; deleted = 0; flushes = 0
  by_action = Hash.new(0)
  sample = []
  batch  = []

  del = lambda do
    next if batch.empty?
    deleted += c.del(*batch).to_i if APPLY
    batch.clear
  end

  c.scan_each(match: PATTERN, count: COUNT) do |key|
    next unless key.start_with?(PREFIX)   # belt and braces: a DEL is irreversible
    total += 1
    rest = key[PREFIX.length..-1].to_s
    by_action[ACTIONS.find { |a| rest.start_with?(a + '_') } || '(other)'] += 1
    sample << [key, c.ttl(key)] if sample.size < 8   # TTL captured BEFORE deletion
    batch << key
    if batch.size >= BATCH
      del.call
      flushes += 1
      puts "  ...#{total} keys seen, #{deleted} deleted  (#{(Time.now - t0).round}s)" if flushes % 25 == 0
      sleep 0.01
    end
  end
  del.call

  puts "=== RESULT (#{(Time.now - t0).round}s) ==="
  puts "  limiter keys found : #{total}"
  puts "  keys deleted       : #{APPLY ? deleted : 0}#{APPLY ? '' : '   (dry run)'}"
  unless by_action.empty?
    puts "  by guarded action  :"
    by_action.sort_by { |_, n| -n }.each { |a, n| puts format("    %-32s %d", a, n) }
  end
  unless sample.empty?
    puts "  sample (ttl BEFORE delete — a huge ttl is the stale-key defect):"
    sample.each { |k, t| puts "    #{k}  ttl=#{t}s" }
  end
  puts
  puts(APPLY ? "  Done. Re-test the app now." : "  Re-run with APPLY=yes to delete these.")
end

r = store.redis
r.respond_to?(:with) ? r.with { |c| sweep.call(c) } : sweep.call(r)
