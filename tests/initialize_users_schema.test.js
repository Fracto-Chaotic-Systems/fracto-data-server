import test from "node:test";
import assert from "node:assert/strict";
import {
  AUTH_BOOTSTRAP_STATE_TABLE_DEFINITION,
  LOGIN_EVENTS_TABLE_DEFINITION,
  USERS_TABLE_DEFINITION,
  initialize_user_tables,
} from "../handlers/initialize_users.js";

test("clean authentication schema creates empty user and bootstrap tables without seeding accounts", async (t) => {
  const statements = [];
  const definitions = [
    USERS_TABLE_DEFINITION,
    LOGIN_EVENTS_TABLE_DEFINITION,
    AUTH_BOOTSTRAP_STATE_TABLE_DEFINITION,
  ];
  const connection = {
    query(sql, callback) {
      statements.push(sql);
      if (sql.startsWith("SHOW COLUMNS FROM")) {
        const table = sql.match(/SHOW COLUMNS FROM `([^`]+)`/)?.[1];
        const definition = definitions.find((entry) => entry.table === table);
        callback(null, (definition?.columns || []).map((column) => ({
          Field: column.match(/^`([^`]+)`/)?.[1],
        })));
        return;
      }
      callback(null, []);
    },
    end(callback) { callback(); },
  };
  t.mock.method(console, "log", () => {});

  await initialize_user_tables(() => connection);

  const create_marker = statements.find((sql) =>
    sql.startsWith("CREATE TABLE IF NOT EXISTS `auth_bootstrap_state`"),
  );
  const create_users = statements.find((sql) =>
    sql.startsWith("CREATE TABLE IF NOT EXISTS `users`"),
  );
  assert.ok(create_users);
  assert.match(create_users, /`enabled` TINYINT\(1\) NOT NULL DEFAULT 0/);
  assert.ok(create_marker);
  assert.match(create_marker, /`id` TINYINT UNSIGNED NOT NULL PRIMARY KEY/);
  assert.match(create_marker, /`user_id` BIGINT UNSIGNED NOT NULL/);
  assert.match(create_marker, /`completed_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP/);
  assert.ok(statements.some((sql) =>
    sql.startsWith("CREATE TABLE IF NOT EXISTS `login_events`"),
  ));
  assert.equal(statements.some((sql) => /^INSERT\s/i.test(sql)), false);
});
