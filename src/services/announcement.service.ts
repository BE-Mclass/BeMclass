import { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { database } from "../config/database";
import { UserRole } from "../types/auth.types";
import { AppError } from "../utils/errors";

const CATEGORIES = [
  "academic",
  "activity",
  "holiday",
  "important",
  "achievement",
  "info",
] as const;
const AUDIENCES = ["all", "siswa", "guru", "wali"] as const;
const PRIORITIES = ["low", "normal", "important", "urgent"] as const;
const STATUSES = ["draft", "published"] as const;

type AnnouncementCategory = (typeof CATEGORIES)[number];
type AnnouncementAudience = (typeof AUDIENCES)[number];
type AnnouncementPriority = (typeof PRIORITIES)[number];
type AnnouncementStatus = (typeof STATUSES)[number];

interface AnnouncementInput {
  category: AnnouncementCategory;
  title: string;
  publishDate: string;
  targetAudience: AnnouncementAudience;
  priority: AnnouncementPriority;
  description: string;
  status: AnnouncementStatus;
}

const EDITABLE_FIELDS = [
  "category",
  "title",
  "publish_date",
  "publishDate",
  "target_audience",
  "targetAudience",
  "priority",
  "description",
  "status",
];

function validationError(errors: Record<string, string>): never {
  throw new AppError("Validasi data pengumuman gagal.", 400, {
    code: "VALIDATION_ERROR",
    errors,
  });
}

function asObject(payload: unknown): Record<string, unknown> {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    validationError({ _form: "Data pengumuman harus berupa objek." });
  }
  return payload as Record<string, unknown>;
}

function hasValue(payload: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(payload, key);
}

function readValue(
  payload: Record<string, unknown>,
  snakeCase: string,
  camelCase?: string
): unknown {
  if (hasValue(payload, snakeCase)) {
    return payload[snakeCase];
  }
  return camelCase ? payload[camelCase] : undefined;
}

function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

function parseAnnouncement(
  payload: unknown,
  current?: AnnouncementInput
): AnnouncementInput {
  const body = asObject(payload);
  const errors: Record<string, string> = {};

  if (
    current &&
    !EDITABLE_FIELDS.some((field) => hasValue(body, field))
  ) {
    validationError({ _form: "Tidak ada perubahan pengumuman yang dikirim." });
  }

  const categoryValue = readValue(body, "category");
  const category =
    categoryValue === undefined && current ? current.category : categoryValue;
  if (!CATEGORIES.includes(category as AnnouncementCategory)) {
    errors.category = "Jenis pengumuman wajib dipilih.";
  }

  const titleValue = readValue(body, "title");
  const title =
    titleValue === undefined && current
      ? current.title
      : typeof titleValue === "string"
        ? titleValue.trim()
        : "";
  if (!title) {
    errors.title = "Judul pengumuman wajib diisi.";
  } else if (title.length > 200) {
    errors.title = "Judul pengumuman maksimal 200 karakter.";
  }

  const dateValue = readValue(body, "publish_date", "publishDate");
  const publishDate =
    dateValue === undefined && current
      ? current.publishDate
      : typeof dateValue === "string"
        ? dateValue.trim()
        : "";
  if (!isValidDate(publishDate)) {
    errors.publish_date = "Tanggal publikasi wajib diisi dengan format YYYY-MM-DD.";
  }

  const audienceValue = readValue(
    body,
    "target_audience",
    "targetAudience"
  );
  const targetAudience =
    audienceValue === undefined && current
      ? current.targetAudience
      : audienceValue;
  if (!AUDIENCES.includes(targetAudience as AnnouncementAudience)) {
    errors.target_audience = "Target audiens tidak valid.";
  }

  const priorityValue = readValue(body, "priority");
  const priority =
    priorityValue === undefined && current ? current.priority : priorityValue;
  if (!PRIORITIES.includes(priority as AnnouncementPriority)) {
    errors.priority = "Prioritas pengumuman tidak valid.";
  }

  const descriptionValue = readValue(body, "description");
  const description =
    descriptionValue === undefined && current
      ? current.description
      : typeof descriptionValue === "string"
        ? descriptionValue.trim()
        : "";
  if (!description) {
    errors.description = "Deskripsi pengumuman wajib diisi.";
  } else if (description.length > 16000) {
    errors.description = "Deskripsi pengumuman maksimal 16.000 karakter.";
  }

  const statusValue = readValue(body, "status");
  const status =
    statusValue === undefined
      ? current
        ? current.status
        : "published"
      : statusValue;
  if (!STATUSES.includes(status as AnnouncementStatus)) {
    errors.status = "Status pengumuman harus draft atau published.";
  }

  if (Object.keys(errors).length > 0) {
    validationError(errors);
  }

  return {
    category: category as AnnouncementCategory,
    title,
    publishDate,
    targetAudience: targetAudience as AnnouncementAudience,
    priority: priority as AnnouncementPriority,
    description,
    status: status as AnnouncementStatus,
  };
}

function announcementVisibility(role: UserRole): string {
  return role === "siswa"
    ? " AND status = 'published' AND target_audience IN ('all', 'siswa')"
    : "";
}

export async function listAnnouncements(role: UserRole) {
  const [rows] = await database.execute<RowDataPacket[]>(
    `SELECT id, category, title, DATE_FORMAT(publish_date, '%Y-%m-%d') AS publish_date,
            target_audience, priority,
            description, status, created_by, published_at, created_at, updated_at
     FROM announcements
     WHERE 1 = 1${announcementVisibility(role)}
     ORDER BY publish_date DESC, created_at DESC`
  );
  return rows;
}

export async function getAnnouncement(id: number, role: UserRole) {
  const [rows] = await database.execute<RowDataPacket[]>(
    `SELECT id, category, title, DATE_FORMAT(publish_date, '%Y-%m-%d') AS publish_date,
            target_audience, priority,
            description, status, created_by, published_at, created_at, updated_at
     FROM announcements
     WHERE id = ?${announcementVisibility(role)}
     LIMIT 1`,
    [id]
  );
  if (rows.length === 0) {
    throw new AppError("Pengumuman tidak ditemukan.", 404, {
      code: "ANNOUNCEMENT_NOT_FOUND",
    });
  }
  return rows[0];
}

export async function createAnnouncement(payload: unknown, authorId: number) {
  const input = parseAnnouncement(payload);
  const [result] = await database.execute<ResultSetHeader>(
    `INSERT INTO announcements
      (category, title, publish_date, target_audience, priority, description,
       status, created_by, published_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, IF(? = 'published', NOW(), NULL))`,
    [
      input.category,
      input.title,
      input.publishDate,
      input.targetAudience,
      input.priority,
      input.description,
      input.status,
      authorId,
      input.status,
    ]
  );
  return getAnnouncement(result.insertId, "admin");
}

export async function updateAnnouncement(id: number, payload: unknown) {
  const existing = await getAnnouncement(id, "admin");
  const current: AnnouncementInput = {
    category: existing.category,
    title: existing.title,
    publishDate: existing.publish_date,
    targetAudience: existing.target_audience,
    priority: existing.priority,
    description: existing.description,
    status: existing.status,
  };
  const input = parseAnnouncement(payload, current);
  await database.execute(
    `UPDATE announcements
     SET category = ?, title = ?, publish_date = ?, target_audience = ?,
         priority = ?, description = ?, status = ?,
         published_at = CASE
           WHEN ? = 'published' THEN COALESCE(published_at, NOW())
           ELSE NULL
         END
     WHERE id = ?`,
    [
      input.category,
      input.title,
      input.publishDate,
      input.targetAudience,
      input.priority,
      input.description,
      input.status,
      input.status,
      id,
    ]
  );
  return getAnnouncement(id, "admin");
}

export async function deleteAnnouncement(id: number): Promise<void> {
  const [result] = await database.execute<ResultSetHeader>(
    `DELETE FROM announcements WHERE id = ?`,
    [id]
  );
  if (result.affectedRows === 0) {
    throw new AppError("Pengumuman tidak ditemukan.", 404, {
      code: "ANNOUNCEMENT_NOT_FOUND",
    });
  }
}
