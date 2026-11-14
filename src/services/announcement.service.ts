import { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { database } from "../config/database";
import { UserRole } from "../types/auth.types";
import { AppError } from "../utils/errors";
import { NotificationService } from "./notification.service";

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

export type AnnouncementCategory = (typeof CATEGORIES)[number];
export type AnnouncementAudience = (typeof AUDIENCES)[number];
export type AnnouncementPriority = (typeof PRIORITIES)[number];
export type AnnouncementStatus = (typeof STATUSES)[number];

export const CATEGORY_ALIASES: Record<string, AnnouncementCategory> = {
  academic: "academic",
  akademik: "academic",
  activity: "activity",
  kegiatan: "activity",
  holiday: "holiday",
  libur: "holiday",
  "libur-cuti": "holiday",
  important: "important",
  penting: "important",
  achievement: "achievement",
  prestasi: "achievement",
  info: "info",
};

export const CATEGORY_TO_TYPE: Record<AnnouncementCategory, string> = {
  academic: "akademik",
  activity: "kegiatan",
  holiday: "libur",
  important: "penting",
  achievement: "prestasi",
  info: "info",
};

export const AUDIENCE_ALIASES: Record<string, AnnouncementAudience> = {
  all: "all",
  semua: "all",
  siswa: "siswa",
  guru: "guru",
  wali: "wali",
};

export const AUDIENCE_TO_FSD: Record<AnnouncementAudience, string> = {
  all: "semua",
  siswa: "siswa",
  guru: "guru",
  wali: "wali",
};

export const PRIORITY_ALIASES: Record<string, AnnouncementPriority> = {
  low: "low",
  rendah: "low",
  normal: "normal",
  important: "important",
  penting: "important",
  urgent: "urgent",
};

export const PRIORITY_TO_FSD: Record<AnnouncementPriority, string> = {
  low: "rendah",
  normal: "normal",
  important: "penting",
  urgent: "urgent",
};

interface AnnouncementInput {
  category: AnnouncementCategory;
  title: string;
  publishDate: string;
  endDate: string | null;
  targetAudience: AnnouncementAudience;
  classId: number | null;
  priority: AnnouncementPriority;
  description: string;
  status: AnnouncementStatus;
}

const EDITABLE_FIELDS = [
  "category",
  "type",
  "title",
  "publish_date",
  "publishDate",
  "event_date",
  "eventDate",
  "end_date",
  "endDate",
  "target_audience",
  "targetAudience",
  "audience",
  "class_id",
  "classId",
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
  ...keys: string[]
): unknown {
  for (const key of keys) {
    if (hasValue(payload, key)) {
      return payload[key];
    }
  }
  return undefined;
}

export function isValidDate(value: string): boolean {
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

  const rawCategory = readValue(body, "category", "type");
  const normalizedCategory =
    rawCategory === undefined && current
      ? current.category
      : typeof rawCategory === "string"
        ? CATEGORY_ALIASES[rawCategory.trim().toLowerCase()]
        : undefined;
  if (!normalizedCategory) {
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

  const dateValue = readValue(
    body,
    "publish_date",
    "publishDate",
    "event_date",
    "eventDate"
  );
  const publishDate =
    dateValue === undefined && current
      ? current.publishDate
      : typeof dateValue === "string"
        ? dateValue.trim()
        : "";
  if (!isValidDate(publishDate)) {
    errors.publish_date = "Tanggal publikasi wajib diisi dengan format YYYY-MM-DD.";
  }

  const endDateValue = readValue(body, "end_date", "endDate");
  let endDate: string | null = null;
  if (endDateValue === undefined && current) {
    endDate = current.endDate;
  } else if (endDateValue === null || endDateValue === "" || endDateValue === undefined) {
    endDate = null;
  } else if (typeof endDateValue === "string" && isValidDate(endDateValue.trim())) {
    endDate = endDateValue.trim();
  } else {
    errors.end_date = "Tanggal selesai harus berformat YYYY-MM-DD.";
  }

  if (endDate && isValidDate(publishDate) && endDate < publishDate) {
    errors.end_date = "Tanggal selesai tidak boleh lebih awal dari tanggal mulai.";
  }

  const rawAudience = readValue(
    body,
    "target_audience",
    "targetAudience",
    "audience"
  );
  const normalizedAudience =
    rawAudience === undefined && current
      ? current.targetAudience
      : typeof rawAudience === "string"
        ? AUDIENCE_ALIASES[rawAudience.trim().toLowerCase()]
        : undefined;
  if (!normalizedAudience) {
    errors.target_audience = "Target audiens tidak valid.";
  }

  const rawClassId = readValue(body, "class_id", "classId");
  let classId: number | null = null;
  if (rawClassId === undefined && current) {
    classId = current.classId;
  } else if (rawClassId === null || rawClassId === "" || rawClassId === undefined) {
    classId = null;
  } else {
    const parsedId =
      typeof rawClassId === "number"
        ? rawClassId
        : typeof rawClassId === "string" && /^\d+$/.test(rawClassId.trim())
          ? Number(rawClassId.trim())
          : Number.NaN;
    if (!Number.isSafeInteger(parsedId) || parsedId <= 0) {
      errors.class_id = "ID kelas harus berupa bilangan bulat positif.";
    } else {
      classId = parsedId;
    }
  }

  const rawPriority = readValue(body, "priority");
  const normalizedPriority =
    rawPriority === undefined && current
      ? current.priority
      : typeof rawPriority === "string"
        ? PRIORITY_ALIASES[rawPriority.trim().toLowerCase()]
        : undefined;
  if (!normalizedPriority) {
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
    category: normalizedCategory as AnnouncementCategory,
    title,
    publishDate,
    endDate,
    targetAudience: normalizedAudience as AnnouncementAudience,
    classId,
    priority: normalizedPriority as AnnouncementPriority,
    description,
    status: status as AnnouncementStatus,
  };
}

function mapAnnouncementRow(row: RowDataPacket) {
  const category = row.category as AnnouncementCategory;
  const targetAudience = row.target_audience as AnnouncementAudience;
  const priority = row.priority as AnnouncementPriority;

  return {
    id: row.id,
    category,
    type: CATEGORY_TO_TYPE[category] ?? category,
    title: row.title,
    publish_date: row.publish_date,
    event_date: row.publish_date,
    end_date: row.end_date ?? null,
    target_audience: targetAudience,
    audience: AUDIENCE_TO_FSD[targetAudience] ?? targetAudience,
    class_id: row.class_id ?? null,
    priority,
    priority_label: PRIORITY_TO_FSD[priority] ?? priority,
    description: row.description,
    status: row.status,
    created_by: row.created_by,
    published_at: row.published_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function announcementVisibility(
  role: UserRole,
  studentClassId?: number | null
): { clause: string; params: Array<string | number> } {
  if (role === "siswa") {
    if (studentClassId) {
      return {
        clause:
          " AND deleted_at IS NULL AND status = 'published' AND target_audience IN ('all', 'siswa') AND (class_id IS NULL OR class_id = ?)",
        params: [studentClassId],
      };
    }
    return {
      clause:
        " AND deleted_at IS NULL AND status = 'published' AND target_audience IN ('all', 'siswa') AND class_id IS NULL",
      params: [],
    };
  }
  return {
    clause: " AND deleted_at IS NULL",
    params: [],
  };
}

export interface ListAnnouncementFilters {
  type?: unknown;
  category?: unknown;
  audience?: unknown;
  target_audience?: unknown;
  priority?: unknown;
  status?: unknown;
  class_id?: unknown;
  from?: unknown;
  to?: unknown;
  q?: unknown;
}

export async function listAnnouncements(
  role: UserRole,
  studentClassId?: number | null,
  filters?: ListAnnouncementFilters
) {
  const vis = announcementVisibility(role, studentClassId);
  const whereClauses: string[] = [vis.clause];
  const params: Array<string | number> = [...vis.params];

  const rawCategory = filters?.category ?? filters?.type;
  if (typeof rawCategory === "string" && rawCategory.trim() !== "") {
    const mapped = CATEGORY_ALIASES[rawCategory.trim().toLowerCase()];
    if (mapped) {
      whereClauses.push(" AND category = ?");
      params.push(mapped);
    }
  }

  const rawAudience = filters?.target_audience ?? filters?.audience;
  if (typeof rawAudience === "string" && rawAudience.trim() !== "") {
    const mapped = AUDIENCE_ALIASES[rawAudience.trim().toLowerCase()];
    if (mapped) {
      whereClauses.push(" AND target_audience = ?");
      params.push(mapped);
    }
  }

  if (typeof filters?.priority === "string" && filters.priority.trim() !== "") {
    const mapped = PRIORITY_ALIASES[filters.priority.trim().toLowerCase()];
    if (mapped) {
      whereClauses.push(" AND priority = ?");
      params.push(mapped);
    }
  }

  if (
    role !== "siswa" &&
    typeof filters?.status === "string" &&
    STATUSES.includes(filters.status.trim() as AnnouncementStatus)
  ) {
    whereClauses.push(" AND status = ?");
    params.push(filters.status.trim());
  }

  if (
    typeof filters?.class_id === "string" &&
    /^\d+$/.test(filters.class_id.trim())
  ) {
    whereClauses.push(" AND class_id = ?");
    params.push(Number(filters.class_id.trim()));
  }

  if (typeof filters?.from === "string" && isValidDate(filters.from.trim())) {
    whereClauses.push(" AND COALESCE(end_date, publish_date) >= ?");
    params.push(filters.from.trim());
  }

  if (typeof filters?.to === "string" && isValidDate(filters.to.trim())) {
    whereClauses.push(" AND publish_date <= ?");
    params.push(filters.to.trim());
  }

  if (typeof filters?.q === "string" && filters.q.trim() !== "") {
    const term = `%${filters.q.trim()}%`;
    whereClauses.push(" AND (title LIKE ? OR description LIKE ?)");
    params.push(term, term);
  }

  const [rows] = await database.execute<RowDataPacket[]>(
    `SELECT id, category, title,
            DATE_FORMAT(publish_date, '%Y-%m-%d') AS publish_date,
            DATE_FORMAT(end_date, '%Y-%m-%d') AS end_date,
            target_audience, class_id, priority,
            description, status, created_by, published_at, created_at, updated_at
     FROM announcements
     WHERE 1 = 1${whereClauses.join("")}
     ORDER BY publish_date DESC, created_at DESC`,
    params
  );
  return rows.map(mapAnnouncementRow);
}

export async function getAnnouncement(
  id: number,
  role: UserRole,
  studentClassId?: number | null
) {
  const vis = announcementVisibility(role, studentClassId);
  const [rows] = await database.execute<RowDataPacket[]>(
    `SELECT id, category, title,
            DATE_FORMAT(publish_date, '%Y-%m-%d') AS publish_date,
            DATE_FORMAT(end_date, '%Y-%m-%d') AS end_date,
            target_audience, class_id, priority,
            description, status, created_by, published_at, created_at, updated_at
     FROM announcements
     WHERE id = ?${vis.clause}
     LIMIT 1`,
    [id, ...vis.params]
  );
  if (rows.length === 0) {
    throw new AppError("Pengumuman tidak ditemukan.", 404, {
      code: "ANNOUNCEMENT_NOT_FOUND",
    });
  }
  return mapAnnouncementRow(rows[0]);
}

export async function createAnnouncement(payload: unknown, authorId: number) {
  const input = parseAnnouncement(payload);
  const [result] = await database.execute<ResultSetHeader>(
    `INSERT INTO announcements
      (category, title, publish_date, end_date, target_audience, class_id, priority, description,
       status, created_by, published_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, IF(? = 'published', NOW(), NULL))`,
    [
      input.category,
      input.title,
      input.publishDate,
      input.endDate,
      input.targetAudience,
      input.classId,
      input.priority,
      input.description,
      input.status,
      authorId,
      input.status,
    ]
  );
  const created = await getAnnouncement(result.insertId, "admin");
  if (input.status === "published") {
    await NotificationService.notifyAnnouncementPublished({
      announcementId: result.insertId,
      title: input.title,
      description: input.description,
      category: input.category,
      priority: input.priority,
      targetAudience: input.targetAudience,
      classId: input.classId,
    });
  }
  return created;
}

export async function updateAnnouncement(id: number, payload: unknown) {
  const existing = await getAnnouncement(id, "admin");
  const current: AnnouncementInput = {
    category: existing.category,
    title: existing.title,
    publishDate: existing.publish_date,
    endDate: existing.end_date,
    targetAudience: existing.target_audience,
    classId: existing.class_id,
    priority: existing.priority,
    description: existing.description,
    status: existing.status,
  };
  const input = parseAnnouncement(payload, current);
  await database.execute(
    `UPDATE announcements
     SET category = ?, title = ?, publish_date = ?, end_date = ?,
         target_audience = ?, class_id = ?, priority = ?, description = ?, status = ?,
         published_at = CASE
           WHEN ? = 'published' THEN COALESCE(published_at, NOW())
           ELSE NULL
         END
     WHERE id = ? AND deleted_at IS NULL`,
    [
      input.category,
      input.title,
      input.publishDate,
      input.endDate,
      input.targetAudience,
      input.classId,
      input.priority,
      input.description,
      input.status,
      input.status,
      id,
    ]
  );
  const updated = await getAnnouncement(id, "admin");
  // Jika baru saja dipublikasikan dari draft -> published, kirim notifikasi (BR-50f)
  if (existing.status !== "published" && input.status === "published") {
    await NotificationService.notifyAnnouncementPublished({
      announcementId: id,
      title: input.title,
      description: input.description,
      category: input.category,
      priority: input.priority,
      targetAudience: input.targetAudience,
      classId: input.classId,
    });
  }
  return updated;
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
