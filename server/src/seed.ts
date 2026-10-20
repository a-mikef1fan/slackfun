import type { Store } from './store.js';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** Populate an empty database with demo users, channels, messages, a thread, reactions and DMs. */
export function seedDemoData(store: Store): boolean {
  const db = store.db;
  if ((db.prepare('SELECT COUNT(*) AS c FROM users').get() as { c: number }).c > 0) return false;

  const tx = db.transaction(() => {
    const now = Date.now();
    const mk = (name: string) => store.findOrCreateUser(name, { demo: true }).user;

    // Channels first so the demo users auto-join the default ones.
    const bootstrap = mk('Maya Okafor');
    const channel = (name: string, topic: string, isDefault: boolean) => {
      const id = store.createChannel(bootstrap.id, name, topic);
      if (isDefault) db.prepare('UPDATE conversations SET is_default = 1 WHERE id = ?').run(id);
      return id;
    };
    const general = channel('general', 'Company-wide announcements and good vibes', true);
    const random = channel('random', 'Memes, music, and whatever is on your mind', true);
    const engineering = channel('engineering', 'Builds, bugs, and architecture talk', false);

    const maya = bootstrap;
    const theo = mk('Theo Lindqvist');
    const priya = mk('Priya Raman');
    const jonas = mk('Jonas Weber');
    for (const u of [maya, theo, priya, jonas]) {
      store.addMember(general, u.id, 0);
      store.addMember(random, u.id, 0);
    }
    for (const u of [maya, theo, priya]) store.addMember(engineering, u.id, 0);

    let clock = now - 6 * DAY;
    const say = (conv: number, user: { id: string }, body: string, gapMin = 17, parentId: number | null = null) => {
      clock += gapMin * MIN;
      const res = db
        .prepare('INSERT INTO messages (conversation_id, user_id, parent_id, body, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(conv, user.id, parentId, body, clock);
      return Number(res.lastInsertRowid);
    };
    const react = (messageId: number, user: { id: string }, emoji: string) =>
      db
        .prepare('INSERT OR IGNORE INTO reactions (message_id, user_id, emoji, created_at) VALUES (?, ?, ?, ?)')
        .run(messageId, user.id, emoji, clock);

    // Older filler so pagination has something to page through.
    const filler = [
      'Morning all, coffee machine on the 2nd floor is fixed.',
      'Reminder: timesheets are due Friday.',
      'Anyone up for lunch at the noodle place?',
      'Standup notes are in the shared doc.',
      'The staging environment is back to green.',
      'Heads up, fire drill at 3pm.',
      'Who has the adapter for the big monitor?',
      'Thanks for covering the on-call shift!',
    ];
    for (let i = 0; i < 64; i++) say(general, [maya, theo, priya, jonas][i % 4], `${filler[i % filler.length]} (#${i + 1})`, 45);

    clock = now - 2 * DAY;
    const welcome = say(general, maya, 'Welcome to Huddle! This is #general, the place for team-wide updates.', 5);
    react(welcome, theo, '🎉');
    react(welcome, priya, '🎉');
    react(welcome, jonas, '👋');
    say(general, theo, 'Great to be here. Pinning our launch checklist this afternoon.', 22);
    const lunch = say(general, jonas, 'Team lunch on Thursday? I can book a table for six.', 140);
    react(lunch, maya, '👍');
    say(general, priya, 'Count me in. Vegetarian options please!', 12, null);
    clock = now - 3 * HOUR;
    const launch = say(general, maya, 'Launch review is at 2pm tomorrow. Please add your notes to the doc before then.', 3);
    react(launch, theo, '✅');
    react(launch, jonas, '✅');
    react(launch, priya, '👀');
    say(general, jonas, 'Will do. I also drafted the announcement copy, will share shortly.', 41);

    clock = now - 5 * DAY;
    say(random, theo, 'Found this amazing lo-fi playlist for focus time.', 30);
    const pizza = say(random, priya, 'Friday pizza poll: pepperoni, margherita, or pineapple (be brave)?', 90);
    react(pizza, jonas, '🍕');
    react(pizza, maya, '🍕');
    say(random, jonas, 'Margherita, always. Pineapple is a crime.', 8);
    say(random, maya, 'The office plant has a new leaf. I named it Gerald.', 600);

    clock = now - 1 * DAY - 4 * HOUR;
    say(engineering, theo, 'Kicking off the realtime work this week. WebSocket gateway design doc is up.', 4);
    const deploy = say(engineering, priya, 'Deploy pipeline is green on main. Release candidate cut.', 55);
    react(deploy, theo, '🚀');
    react(deploy, maya, '🚀');
    react(deploy, theo, '🙌');
    const q = say(engineering, maya, 'Should we use SQLite FTS5 for message search or bring in a dedicated search service?', 120);
    say(engineering, theo, 'FTS5 should be plenty for our volume, and it keeps deployment simple.', 6, q);
    say(engineering, priya, 'Agreed. We can revisit if we hit millions of messages. Prefix queries work well for typeahead.', 9, q);
    say(engineering, maya, 'Perfect, going with FTS5. I will write up the query syntax (in: and from: filters).', 7, q);
    react(q, theo, '💡');
    clock = now - 40 * MIN;
    say(engineering, priya, 'Heads up: flaky test in the reactions suite, investigating now.', 2);
    say(engineering, theo, 'I can pair on it after standup if you want a second pair of eyes.', 11);

    // DMs: one 1:1 (Maya <-> Theo, unread for Maya) and one group (Maya, Priya, Jonas)
    const dm1 = store.findOrCreateDm([maya.id, theo.id]).id;
    clock = now - 5 * HOUR;
    say(dm1, maya, 'Do you have 10 minutes to sync on the gateway design?', 1);
    say(dm1, theo, 'Sure, give me five. Finishing a review.', 4);
    say(dm1, theo, 'Ready when you are. Also: I added a section on reconnect backoff.', 9);
    say(dm1, theo, 'Let me know what you think of the resync approach.', 2);

    const dm2 = store.findOrCreateDm([maya.id, priya.id, jonas.id]).id;
    clock = now - 26 * HOUR;
    say(dm2, jonas, 'Surprise party planning thread for Priya... oh wait.', 1);
    say(dm2, priya, 'I can see this, Jonas.', 3);
    const oops = say(dm2, jonas, 'Oops. Forget everything you just read.', 1);
    react(oops, maya, '😂');

    // Read state: everyone has read everything except a few unread demo items.
    db.prepare('UPDATE members SET last_read_id = (SELECT COALESCE(MAX(id),0) FROM messages)').run();
    const lastIn = (conv: number) =>
      (db.prepare('SELECT MAX(id) AS m FROM messages WHERE conversation_id = ?').get(conv) as { m: number }).m;
    // Maya has unread DMs from Theo, and is behind in #engineering and #random.
    db.prepare('UPDATE members SET last_read_id = ? WHERE conversation_id = ? AND user_id = ?').run(lastIn(dm1) - 2, dm1, maya.id);
    db.prepare('UPDATE members SET last_read_id = ? WHERE conversation_id = ? AND user_id = ?').run(lastIn(engineering) - 2, engineering, maya.id);
    db.prepare('UPDATE members SET last_read_id = ? WHERE conversation_id = ? AND user_id = ?').run(lastIn(random) - 1, random, maya.id);
  });
  tx();
  return true;
}
