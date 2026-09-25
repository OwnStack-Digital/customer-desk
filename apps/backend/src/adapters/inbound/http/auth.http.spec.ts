import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { INestApplication } from "@nestjs/common";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AppModule } from "../../../app.module";
import { CONFIG } from "../../outbound/config-files/config.module";
import type { ValidatedConfig } from "../../outbound/config-files/loader";
import {
  createPersistenceClient,
  PERSISTENCE_CLIENT,
  type SqliteDb,
} from "../../outbound/persistence/client";
import { sqliteOperatorSessions } from "../../outbound/persistence/schema";

// apps/backend/src/adapters/inbound/http -> apps/backend/drizzle/migrations.
const MIGRATIONS = join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "drizzle",
  "migrations",
  "sqlite",
);

const OWNER_EMAIL = "owner@harbourandpine.example";
const OWNER_PASSWORD = "owner-test-secret";

let dbFile: string;
let app: INestApplication;

function cookieToken(setCookie: string): string {
  return setCookie.split(";")[0]?.split("=")[1] ?? "";
}

beforeAll(async () => {
  dbFile = join(mkdtempSync(join(tmpdir(), "bos-http-")), "test.db");
  process.env.DB_DIALECT = "sqlite";
  process.env.DATABASE_URL = `file:${dbFile}`;
  process.env.BOS_OWNER_EMAIL = OWNER_EMAIL;
  process.env.BOS_OWNER_PASSWORD = OWNER_PASSWORD;
  delete process.env.COOKIE_SECURE;

  // Tables must exist before the boot-time owner seeder runs on app.init().
  const client = createPersistenceClient();
  migrate(client.open() as SqliteDb, { migrationsFolder: MIGRATIONS });

  const { Test } = await import("@nestjs/testing");
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  app = moduleRef.createNestApplication();
  await app.init();
});

afterAll(async () => {
  await app.close();
  rmSync(dbFile, { force: true });
});

describe("one-org auth over HTTP", () => {
  it("rejects anonymous GET /inbox with the shared 401 shape", async () => {
    const response = await request(app.getHttpServer()).get("/inbox");
    expect(response.status).toBe(401);
    expect(response.body).toEqual({
      error: { code: "unauthorized", message: expect.any(String) },
    });
  });

  it("rejects a wrong password with the same 401 shape", async () => {
    const response = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: OWNER_EMAIL, password: "definitely-wrong" });
    expect(response.status).toBe(401);
    expect(response.body).toEqual({
      error: { code: "unauthorized", message: expect.any(String) },
    });
  });

  it("logs in, guards /inbox, stores only the hash, and never logs the id", async () => {
    const stdout = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    let sessionToken = "";
    let setCookie = "";
    try {
      const login = await request(app.getHttpServer())
        .post("/auth/login")
        .send({ email: OWNER_EMAIL, password: OWNER_PASSWORD });
      expect(login.status).toBe(200);
      expect(login.body).toEqual({ operator: { email: OWNER_EMAIL } });
      setCookie = login.headers["set-cookie"]?.[0] ?? "";
      expect(setCookie).toContain("bos_session=");
      expect(setCookie).toContain("HttpOnly");
      expect(setCookie).toContain("SameSite=Lax");
      expect(setCookie).toContain("Path=/");
      expect(setCookie).not.toContain("Secure");
      sessionToken = cookieToken(setCookie);
      expect(sessionToken).toHaveLength(26); // ULID

      const inbox = await request(app.getHttpServer())
        .get("/inbox")
        .set("Cookie", setCookie.split(";")[0]);
      expect(inbox.status).toBe(200);
      expect(inbox.body).toEqual({ items: [] });
    } finally {
      const logged = stdout.mock.calls.map((call) => String(call[0])).join("");
      stdout.mockRestore();
      expect(logged).not.toContain(sessionToken);
      expect(logged).not.toContain(
        createHash("sha256").update(sessionToken).digest("hex"),
      );
    }

    // The database stores only the SHA-256 hash of the cookie id.
    const db = app.get(PERSISTENCE_CLIENT) as ReturnType<
      typeof createPersistenceClient
    >;
    const rows = await (db.open() as SqliteDb)
      .select()
      .from(sqliteOperatorSessions);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.tokenHash).toBe(
      createHash("sha256").update(sessionToken).digest("hex"),
    );
    expect(rows[0]?.tokenHash).not.toBe(sessionToken);
    expect(rows[0]?.revokedAt).toBeNull();
  });

  it("revokes the session on logout and then rejects /inbox again", async () => {
    const login = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: OWNER_EMAIL, password: OWNER_PASSWORD });
    const cookie = login.headers["set-cookie"]?.[0]?.split(";")[0] ?? "";
    expect(cookie).toContain("bos_session=");

    const logout = await request(app.getHttpServer())
      .post("/auth/logout")
      .set("Cookie", cookie);
    expect(logout.status).toBe(200);
    expect(logout.headers["set-cookie"]?.[0] ?? "").toContain("bos_session=");
    expect(logout.headers["set-cookie"]?.[0] ?? "").toContain(
      "Expires=Thu, 01 Jan 1970",
    );

    const inbox = await request(app.getHttpServer())
      .get("/inbox")
      .set("Cookie", cookie);
    expect(inbox.status).toBe(401);
    expect(inbox.body.error.code).toBe("unauthorized");

    // Idempotent: a second logout (even anonymous) is a plain success.
    const repeat = await request(app.getHttpServer())
      .post("/auth/logout")
      .set("Cookie", cookie);
    expect(repeat.status).toBe(200);
    const anonymous = await request(app.getHttpServer()).post("/auth/logout");
    expect(anonymous.status).toBe(200);
  });

  it("rejects a malformed login body as 422 validation", async () => {
    const response = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: OWNER_EMAIL });
    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe("validation");
  });

  it("seeds exactly one owner at boot and reuses it", async () => {
    const config = app.get(CONFIG) as ValidatedConfig;
    expect(config.organization.id).toBe("org_harbour_pine");
    const db = app.get(PERSISTENCE_CLIENT) as ReturnType<
      typeof createPersistenceClient
    >;
    const { sqliteOperatorCredentials } = await import(
      "../../outbound/persistence/schema"
    );
    const rows = await (db.open() as SqliteDb)
      .select()
      .from(sqliteOperatorCredentials);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.email).toBe(OWNER_EMAIL);
    expect(rows[0]?.organizationId).toBe("org_harbour_pine");
    expect(Object.values(rows[0] ?? {})).not.toContain(OWNER_PASSWORD);
  });
});
