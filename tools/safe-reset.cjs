// The only way a test suite is allowed to wipe the database.
//
// This existed as a comment-and-guard block copy-pasted into three of the four
// suites that reset. The fourth, verify-rls, never got it — and running it
// destroyed a real owner account, 58 projects and twelve drafts of hand-written
// copy. The guard was correct; keeping four copies of it was not, because a
// guard you have to remember to paste is a guard that protects whatever you
// happened to remember.
//
// So the reset itself lives here, behind the check. There is no longer an
// unguarded way to do it that does not involve typing `supabase db reset` by
// hand, which is a thing a person does deliberately.
const { execFileSync } = require('child_process')
const path = require('path')

const LOOPBACK = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?\/?$/

module.exports = function safeReset(suite) {
  const url = process.env.SUPABASE_URL || 'http://127.0.0.1:54321'
  if (!LOOPBACK.test(url)) {
    console.error(`\n  REFUSED — ${suite} wipes the database and SUPABASE_URL is not local.`)
    console.error(`  SUPABASE_URL = ${url}\n`)
    process.exit(1)
  }

  // A HUMAN account is the signal that this stopped being a scratch database
  // and became somebody's working copy.
  //
  // Counting all accounts was too blunt: every suite signs up its own throwaway
  // owner, so the first one to run left an account behind and the next three
  // refused to start. The suites' own users are the ones at @buildanta.test —
  // a domain reserved for exactly this and impossible to receive mail at — so
  // anything else is a person who will lose their login.
  let humans = '0'
  try {
    humans = execFileSync('docker', ['exec', 'supabase_db_buildanta-cms',
      'psql', '-U', 'postgres', '-t', '-A', '-c',
      "select count(*) from auth.users where email not like '%@buildanta.test'"],
      { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
  } catch { /* no database up: nothing to lose */ }

  if (humans !== '0' && !process.argv.includes('--force')) {
    console.error(`\n  REFUSED — ${suite} wipes the database, and ${humans} real person is signed up here.`)
    console.error('  They lose their login, and any unpublished copy goes with it.')
    console.error('  Re-run with --force if you mean that.\n')
    process.exit(1)
  }

  execFileSync('supabase', ['db', 'reset'],
    { cwd: path.join(__dirname, '..'), stdio: 'ignore' })
}
