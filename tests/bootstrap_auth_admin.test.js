import test from "node:test";
import assert from "node:assert/strict";
import {
  handle_user_upsert,
  handle_user_bootstrap,
  provision_initial_admin,
} from "../handlers/handle_users.js";

const create_lock = () => {
  let held = false;
  const waiters = [];
  return {
    acquire() {
      if (!held) {
        held = true;
        return Promise.resolve();
      }
      return new Promise((resolve) => waiters.push(resolve));
    },
    release() {
      const next = waiters.shift();
      if (next) next();
      else held = false;
    },
  };
};

const create_database = (initial_users = []) => {
  const database = {
    users: initial_users.map((user) => ({ ...user })),
    marker: null,
    next_id: Math.max(0, ...initial_users.map((user) => user.id)) + 1,
    lock: create_lock(),
  };

  const connect = () => {
    let snapshot;
    let has_lock = false;
    return {
      query(sql, values, callback) {
        const execute = async () => {
          if (sql.includes("GET_LOCK")) {
            await database.lock.acquire();
            has_lock = true;
            return [{ acquired: 1 }];
          }
          if (sql === "START TRANSACTION") {
            snapshot = {
              users: database.users.map((user) => ({ ...user })),
              marker: database.marker && { ...database.marker },
              next_id: database.next_id,
            };
            return {};
          }
          if (sql.includes("FROM auth_bootstrap_state")) {
            return database.marker ? [{ ...database.marker }] : [];
          }
          if (sql.includes("FROM users WHERE id = ?")) {
            const user = database.users.find((entry) => entry.id === values[0]);
            return user ? [{ ...user }] : [];
          }
          if (sql.includes("FROM users ORDER BY id FOR UPDATE")) {
            return database.users.map(({ id, provider, provider_subject }) => ({
              id,
              provider,
              provider_subject,
            }));
          }
          if (sql.startsWith("UPDATE users SET")) {
            const user = database.users.find((entry) => entry.id === values[2]);
            Object.assign(user, {
              email: values[0],
              display_name: values[1],
              enabled: 1,
              role: "admin",
            });
            return { affectedRows: 1 };
          }
          if (sql.startsWith("INSERT INTO users")) {
            const user = {
              id: database.next_id++,
              provider: values[0],
              provider_subject: values[1],
              email: values[2],
              display_name: values[3],
              enabled: 1,
              role: "admin",
            };
            database.users.push(user);
            return { insertId: user.id };
          }
          if (sql.startsWith("INSERT INTO auth_bootstrap_state")) {
            database.marker = { id: 1, user_id: values[0] };
            return { affectedRows: 1 };
          }
          if (sql === "COMMIT") return {};
          if (sql === "ROLLBACK") {
            database.users = snapshot.users;
            database.marker = snapshot.marker;
            database.next_id = snapshot.next_id;
            return {};
          }
          if (sql.includes("RELEASE_LOCK")) {
            if (has_lock) database.lock.release();
            has_lock = false;
            return [{ released: 1 }];
          }
          throw new Error(`Unexpected SQL in bootstrap test: ${sql}`);
        };
        execute().then(
          (result) => callback(null, result),
          (error) => callback(error),
        );
      },
    };
  };
  return { database, connect };
};

const identity = (provider_subject = "google-sub-1") => ({
  provider: "google",
  provider_subject,
  email: `${provider_subject}@example.test`,
  display_name: "Installer Admin",
});

test("first bootstrap creates and records one enabled administrator", async () => {
  const { database, connect } = create_database();
  const result = await provision_initial_admin(connect(), identity());

  assert.deepEqual(result, { user_id: 1, already_completed: false });
  assert.equal(database.users[0].enabled, 1);
  assert.equal(database.users[0].role, "admin");
  assert.deepEqual(database.marker, { id: 1, user_id: result.user_id });
  assert.equal(database.users.length, 1);
});

test("same-identity retry confirms completion without restoring changed access", async () => {
  const { database, connect } = create_database();
  const created = await provision_initial_admin(connect(), identity());
  database.users[0].enabled = 0;
  database.users[0].role = null;

  const retry = await provision_initial_admin(connect(), identity());
  assert.deepEqual(retry, { user_id: created.user_id, already_completed: true });
  assert.equal(database.users[0].id, created.user_id);
  assert.equal(database.users[0].enabled, 0);
  assert.equal(database.users[0].role, null);
  assert.equal(database.users.length, 1);
});

test("a different identity cannot use a consumed bootstrap", async () => {
  const { database, connect } = create_database();
  await provision_initial_admin(connect(), identity());

  await assert.rejects(
    provision_initial_admin(connect(), identity("google-sub-2")),
    (error) => error.status === 409,
  );
  assert.equal(database.users.length, 1);
  assert.equal(database.users[0].provider_subject, "google-sub-1");
});

test("bootstrap endpoint rejects a confirmation that does not match", () => {
  const previous_confirmation = process.env.FRACTO_BOOTSTRAP_ADMIN_CONFIRM;
  process.env.FRACTO_BOOTSTRAP_ADMIN_CONFIRM = "expected-private-value";
  const response = {
    status_code: null,
    body: null,
    status(code) { this.status_code = code; return this; },
    json(body) { this.body = body; return this; },
  };

  try {
    handle_user_bootstrap({
      headers: {},
      ip: "127.0.0.1",
      body: { confirmation: "incorrect", provider: "google", provider_subject: "sub" },
    }, response);
    assert.equal(response.status_code, 403);
    assert.equal(response.body.error, "Administrator bootstrap confirmation is invalid");
  } finally {
    if (previous_confirmation === undefined) {
      delete process.env.FRACTO_BOOTSTRAP_ADMIN_CONFIRM;
    } else {
      process.env.FRACTO_BOOTSTRAP_ADMIN_CONFIRM = previous_confirmation;
    }
  }
});

test("bootstrap rejects missing confirmation and non-loopback requests before connecting", () => {
  const previous_confirmation = process.env.FRACTO_BOOTSTRAP_ADMIN_CONFIRM;
  process.env.FRACTO_BOOTSTRAP_ADMIN_CONFIRM = "expected-private-value";
  const invoke = (request) => {
    const response = {
      status_code: null,
      body: null,
      status(code) { this.status_code = code; return this; },
      json(body) { this.body = body; return this; },
    };
    handle_user_bootstrap(request, response, () => {
      assert.fail("database connection must not be opened for rejected requests");
    });
    return response;
  };

  try {
    const missing_confirmation = invoke({
      headers: {},
      ip: "127.0.0.1",
      body: { provider: "google", provider_subject: "private-subject" },
    });
    assert.equal(missing_confirmation.status_code, 403);
    assert.equal(missing_confirmation.body.error, "Administrator bootstrap confirmation is invalid");

    const non_loopback = invoke({
      headers: {},
      ip: "192.0.2.10",
      body: {
        confirmation: "expected-private-value",
        provider: "google",
        provider_subject: "private-subject",
      },
    });
    assert.equal(non_loopback.status_code, 403);
    assert.equal(non_loopback.body.error, "Administrator bootstrap is an internal operation");
  } finally {
    if (previous_confirmation === undefined) {
      delete process.env.FRACTO_BOOTSTRAP_ADMIN_CONFIRM;
    } else {
      process.env.FRACTO_BOOTSTRAP_ADMIN_CONFIRM = previous_confirmation;
    }
  }
});

test("later OIDC sign-ins create and retain a disabled non-admin user", async () => {
  const events = [];
  let user = null;
  const connection = {
    query(sql, values, callback) {
      if (sql.startsWith("INSERT INTO users")) {
        if (user) {
          user.email = values[2];
          user.display_name = values[3];
        } else {
          user = {
            id: 23,
            provider: values[0],
            provider_subject: values[1],
            email: values[2],
            display_name: values[3],
            enabled: 0,
            role: null,
          };
        }
        callback(null, { affectedRows: 1 });
        return;
      }
      if (sql.includes("FROM users WHERE provider = ?")) {
        callback(null, user ? [{ ...user }] : []);
        return;
      }
      if (sql.startsWith("INSERT INTO login_events")) {
        events.push(values);
        callback(null, { affectedRows: 1 });
        return;
      }
      assert.fail(`Unexpected SQL in sign-in test: ${sql}`);
    },
    end(callback) { callback(); },
  };
  const sign_in = (email) => new Promise((resolve) => {
    const response = {
      status_code: 200,
      body: null,
      status(code) { this.status_code = code; return this; },
      json(body) { this.body = body; resolve(this); return this; },
    };
    handle_user_upsert({
      headers: {},
      ip: "127.0.0.1",
      body: {
        provider: "google",
        provider_subject: "later-user-subject",
        email,
        display_name: "Later User",
      },
    }, response, () => connection);
  });

  const first = await sign_in("later@example.test");
  assert.equal(first.status_code, 200);
  assert.equal(user.enabled, 0);
  assert.equal(user.role, null);
  const second = await sign_in("updated@example.test");
  assert.equal(second.status_code, 200);
  assert.equal(user.email, "updated@example.test");
  assert.equal(user.enabled, 0);
  assert.equal(user.role, null);
  assert.equal(events.length, 2);
  assert.deepEqual(events.map((event) => event.slice(3, 5)), [
    ["disabled", 0],
    ["disabled", 0],
  ]);
});

test("bootstrap endpoint safely confirms same-identity replay with the consumed marker", async () => {
  const previous_confirmation = process.env.FRACTO_BOOTSTRAP_ADMIN_CONFIRM;
  const database = { user: null, marker: null, inserts: 0 };
  process.env.FRACTO_BOOTSTRAP_ADMIN_CONFIRM = "one-time-confirmation";
  const connection_factory = () => ({
    query(sql, values, callback) {
      let result = {};
      if (sql.includes("GET_LOCK")) result = [{ acquired: 1 }];
      else if (sql.includes("FROM auth_bootstrap_state")) {
        result = database.marker ? [{ ...database.marker }] : [];
      } else if (sql.includes("FROM users ORDER BY id FOR UPDATE")) {
        result = database.user
          ? [{
            id: database.user.id,
            provider: database.user.provider,
            provider_subject: database.user.provider_subject,
          }]
          : [];
      } else if (sql.startsWith("INSERT INTO users")) {
        database.inserts += 1;
        database.user = {
          id: 9,
          provider: values[0],
          provider_subject: values[1],
          email: values[2],
          display_name: values[3],
          enabled: 1,
          role: "admin",
        };
        result = { insertId: database.user.id };
      } else if (sql.includes("FROM users WHERE id = ?")) {
        result = database.user ? [{ ...database.user }] : [];
      } else if (sql.startsWith("INSERT INTO auth_bootstrap_state")) {
        database.marker = { id: 1, user_id: values[0] };
        result = { affectedRows: 1 };
      } else if (sql.includes("RELEASE_LOCK")) result = [{ released: 1 }];
      callback(null, result);
    },
    end(callback) { callback(); },
  });
  const invoke = (confirmation) => new Promise((resolve) => {
    const response = {
      status_code: 200,
      body: null,
      status(code) { this.status_code = code; return this; },
      json(body) { this.body = body; resolve(this); return this; },
    };
    handle_user_bootstrap({
      headers: {},
      ip: "127.0.0.1",
      body: {
        confirmation,
        provider: "google",
        provider_subject: "verified-subject",
      },
    }, response, connection_factory);
  });

  try {
    const first = await invoke("one-time-confirmation");
    assert.equal(first.status_code, 200);
    assert.deepEqual(first.body, { success: true });
    assert.equal(process.env.FRACTO_BOOTSTRAP_ADMIN_CONFIRM, "one-time-confirmation");
    assert.deepEqual(database.marker, { id: 1, user_id: 9 });

    const replay = await invoke("one-time-confirmation");
    assert.equal(replay.status_code, 200);
    assert.deepEqual(replay.body, { success: true });
    assert.equal(database.inserts, 1);
    assert.equal(replay.body.user, undefined);
    assert.equal(JSON.stringify(replay.body).includes("verified-subject"), false);
  } finally {
    if (previous_confirmation === undefined) {
      delete process.env.FRACTO_BOOTSTRAP_ADMIN_CONFIRM;
    } else {
      process.env.FRACTO_BOOTSTRAP_ADMIN_CONFIRM = previous_confirmation;
    }
  }
});

test("bootstrap may promote the sole already-provisioned matching identity", async () => {
  const { database, connect } = create_database([
    {
      id: 7,
      provider: "google",
      provider_subject: "google-sub-1",
      email: null,
      display_name: null,
      enabled: 0,
      role: null,
    },
  ]);

  const result = await provision_initial_admin(connect(), identity());

  assert.equal(result.user_id, 7);
  assert.equal(database.users[0].enabled, 1);
  assert.equal(database.users[0].role, "admin");
  assert.equal(database.users.length, 1);
  assert.deepEqual(database.marker, { id: 1, user_id: result.user_id });
});

test("unexpected existing users prevent bootstrap", async () => {
  for (const users of [
    [{ id: 1, provider: "google", provider_subject: "someone-else" }],
    [
      { id: 1, provider: "google", provider_subject: "google-sub-1" },
      { id: 2, provider: "google", provider_subject: "someone-else" },
    ],
  ]) {
    const { database, connect } = create_database(users);
    await assert.rejects(
      provision_initial_admin(connect(), identity()),
      (error) => error.status === 409,
    );
    assert.equal(database.marker, null);
    assert.equal(database.users.length, users.length);
  }
});

test("concurrent different bootstrap attempts can only establish one admin", async () => {
  const { database, connect } = create_database();

  const results = await Promise.allSettled([
    provision_initial_admin(connect(), identity("google-sub-a")),
    provision_initial_admin(connect(), identity("google-sub-b")),
  ]);

  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected" && result.reason.status === 409).length, 1);
  assert.equal(database.users.length, 1);
  assert.equal(database.marker.user_id, database.users[0].id);
});
