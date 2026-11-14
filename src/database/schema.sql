-- Database Schema for M-Class (Auth & User/Student Roster Foundation)

CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  email VARCHAR(191) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL COMMENT 'Argon2id hash',
  google_id VARCHAR(191) NULL UNIQUE COMMENT 'Google OIDC subject identifier (for mobile student OAuth)',
  oauth_provider ENUM('local', 'google') NOT NULL DEFAULT 'local',
  phone VARCHAR(30) NULL,
  role ENUM('admin', 'guru', 'siswa') NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  photo_url VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_users_role_active (role, is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS classes (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(50) NOT NULL UNIQUE,
  grade_level TINYINT UNSIGNED NOT NULL COMMENT '7, 8, or 9',
  homeroom_teacher_id BIGINT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_classes_homeroom FOREIGN KEY (homeroom_teacher_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS student_roster (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  nisn CHAR(10) NOT NULL UNIQUE,
  full_name VARCHAR(150) NOT NULL,
  gender ENUM('L', 'P') NOT NULL DEFAULT 'L',
  birth_date DATE NULL,
  class_id BIGINT UNSIGNED NULL,
  attendance_number SMALLINT UNSIGNED NULL,
  guardian_name VARCHAR(150) NULL,
  parent_phone VARCHAR(30) NULL,
  whatsapp_number VARCHAR(30) NULL,
  address VARCHAR(255) NULL,
  biometric_consent_at DATETIME NULL,
  user_id BIGINT UNSIGNED NULL UNIQUE COMMENT 'Populated when student registers in mobile app',
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_roster_class FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE SET NULL,
  CONSTRAINT fk_roster_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS announcements (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  category ENUM('academic', 'activity', 'holiday', 'important', 'achievement', 'info') NOT NULL,
  title VARCHAR(200) NOT NULL,
  publish_date DATE NOT NULL,
  end_date DATE NULL,
  target_audience ENUM('all', 'siswa', 'guru', 'wali') NOT NULL,
  class_id BIGINT UNSIGNED NULL,
  priority ENUM('low', 'normal', 'important', 'urgent') NOT NULL,
  description TEXT NOT NULL,
  status ENUM('draft', 'published') NOT NULL DEFAULT 'draft',
  created_by BIGINT UNSIGNED NULL,
  published_at DATETIME NULL,
  deleted_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_announcements_status_date (status, publish_date, end_date),
  INDEX idx_announcements_audience_status (target_audience, status),
  CONSTRAINT fk_announcements_class FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE SET NULL,
  CONSTRAINT fk_announcements_author FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS school_settings (
  id TINYINT UNSIGNED NOT NULL PRIMARY KEY DEFAULT 1,
  school_name VARCHAR(150) NOT NULL DEFAULT 'MTs Al-Ma''arif',
  latitude DECIMAL(9, 6) NOT NULL DEFAULT -7.982600,
  longitude DECIMAL(9, 6) NOT NULL DEFAULT 112.630800,
  radius_m SMALLINT UNSIGNED NOT NULL DEFAULT 15,
  timezone VARCHAR(40) NOT NULL DEFAULT 'Asia/Jakarta',
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT chk_school_settings_single_row CHECK (id = 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS attendance_schedules (
  id TINYINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  day_of_week TINYINT UNSIGNED NOT NULL COMMENT '1=Senin ... 7=Minggu',
  is_school_day TINYINT(1) NOT NULL DEFAULT 1,
  checkin_open TIME NULL,
  late_after TIME NULL,
  checkin_close TIME NULL,
  UNIQUE KEY uq_schedule_day (day_of_week)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS attendance_attempts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  student_id BIGINT UNSIGNED NOT NULL COMMENT 'References student_roster(id)',
  attempted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'Waktu server otoritatif',
  client_captured_at DATETIME NULL,
  latitude DECIMAL(9, 6) NULL,
  longitude DECIMAL(9, 6) NULL,
  accuracy_m DECIMAL(7, 2) NULL,
  distance_m DECIMAL(8, 2) NULL,
  within_radius TINYINT(1) NULL,
  is_mocked TINYINT(1) NOT NULL DEFAULT 0,
  photo_path VARCHAR(255) NULL,
  face_similarity DECIMAL(6, 5) NULL,
  face_result ENUM('match', 'no_match', 'no_face', 'multiple_faces', 'low_quality', 'error') NULL,
  outcome ENUM(
    'recorded',
    'rejected_outside_radius',
    'rejected_face',
    'rejected_time_window',
    'rejected_mock_location',
    'rejected_gps_accuracy',
    'rejected_already_recorded',
    'rejected_not_enrolled',
    'error'
  ) NOT NULL,
  record_id BIGINT UNSIGNED NULL,
  device VARCHAR(100) NULL,
  model_version VARCHAR(30) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_att_student_time (student_id, attempted_at),
  INDEX idx_att_outcome_time (outcome, attempted_at),
  CONSTRAINT fk_att_student FOREIGN KEY (student_id) REFERENCES student_roster(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS attendance_records (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  student_id BIGINT UNSIGNED NOT NULL COMMENT 'References student_roster(id)',
  attendance_date DATE NOT NULL COMMENT 'Tanggal kalender WIB (YYYY-MM-DD)',
  status ENUM('hadir', 'terlambat', 'izin', 'sakit', 'alpa') NOT NULL,
  source ENUM('face_gps', 'leave', 'auto_alpa', 'manual') NOT NULL DEFAULT 'face_gps',
  check_in_at DATETIME NULL,
  late_minutes SMALLINT UNSIGNED NULL,
  late_reason ENUM('macet', 'kendala_kendaraan', 'keperluan_keluarga', 'lainnya') NULL,
  late_note VARCHAR(120) NULL,
  attempt_id BIGINT UNSIGNED NULL,
  leave_request_id BIGINT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_record_student_date (student_id, attendance_date),
  INDEX idx_rec_date_status (attendance_date, status),
  CONSTRAINT fk_rec_student_roster FOREIGN KEY (student_id) REFERENCES student_roster(id) ON DELETE CASCADE,
  CONSTRAINT fk_rec_attempt FOREIGN KEY (attempt_id) REFERENCES attendance_attempts(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_sessions (
  id CHAR(36) PRIMARY KEY COMMENT 'UUID v4 (JWT jti)',
  user_id BIGINT UNSIGNED NOT NULL,
  client_type ENUM('web', 'mobile') NOT NULL,
  user_agent VARCHAR(255) NULL,
  ip_address VARCHAR(45) NULL,
  remember_me TINYINT(1) NOT NULL DEFAULT 0,
  expires_at DATETIME NOT NULL,
  revoked_at DATETIME NULL,
  last_active_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_sessions_user_active (user_id, revoked_at, expires_at),
  CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS password_resets (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  otp_hash CHAR(64) NOT NULL COMMENT 'HMAC-SHA256 hex of 6-digit OTP',
  attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
  expires_at DATETIME NOT NULL,
  consumed_at DATETIME NULL,
  reset_token_hash CHAR(64) NULL COMMENT 'HMAC-SHA256 hex of single-use reset_token',
  reset_token_expires_at DATETIME NULL,
  last_sent_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_pr_user_created (user_id, created_at),
  INDEX idx_pr_reset_token (reset_token_hash),
  CONSTRAINT fk_pr_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS notifications (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  type VARCHAR(40) NOT NULL COMMENT 'attendance_recorded, outside_radius_attempt, attendance_alpa, leave_submitted, leave_approved, leave_rejected, announcement',
  title VARCHAR(150) NOT NULL,
  body VARCHAR(500) NOT NULL,
  data JSON NULL,
  read_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_notif_user (user_id, read_at, created_at),
  CONSTRAINT fk_notif_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS leave_requests (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  student_id BIGINT UNSIGNED NOT NULL COMMENT 'References student_roster(id)',
  category ENUM('sakit', 'keperluan', 'dispensasi') NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  reason TEXT NOT NULL,
  attachment_path VARCHAR(255) NOT NULL,
  attachment_mime VARCHAR(60) NOT NULL,
  status ENUM('menunggu', 'disetujui', 'ditolak', 'dibatalkan') NOT NULL DEFAULT 'menunggu',
  reviewed_by BIGINT UNSIGNED NULL,
  reviewed_at DATETIME NULL,
  review_note VARCHAR(500) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_leave_student_dates (student_id, start_date, end_date),
  INDEX idx_leave_status_created (status, created_at),
  CONSTRAINT fk_leave_student FOREIGN KEY (student_id) REFERENCES student_roster(id) ON DELETE CASCADE,
  CONSTRAINT fk_leave_reviewer FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT chk_leave_dates CHECK (end_date >= start_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS face_templates (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  student_id BIGINT UNSIGNED NOT NULL COMMENT 'References student_roster(id)',
  embedding VARBINARY(8192) NOT NULL COMMENT 'AES-256-GCM(iv(12) | tag(16) | float32[] little-endian)',
  embedding_dim SMALLINT UNSIGNED NOT NULL,
  model_name VARCHAR(60) NOT NULL,
  model_version VARCHAR(30) NOT NULL,
  quality_score DECIMAL(5, 4) NULL,
  photo_path VARCHAR(255) NULL COMMENT 'Foto referensi (untuk tampilan hasil scan admin/guru)',
  status ENUM('active', 'revoked') NOT NULL DEFAULT 'active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_ft_student_status (student_id, status),
  CONSTRAINT fk_ft_student FOREIGN KEY (student_id) REFERENCES student_roster(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  actor_user_id BIGINT UNSIGNED NULL,
  action VARCHAR(60) NOT NULL,
  entity VARCHAR(40) NULL,
  entity_id VARCHAR(40) NULL,
  meta JSON NULL,
  ip VARCHAR(45) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_audit_actor (actor_user_id, created_at),
  INDEX idx_audit_action (action, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS job_runs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  job_name VARCHAR(60) NOT NULL,
  run_date DATE NOT NULL,
  started_at DATETIME NOT NULL,
  finished_at DATETIME NULL,
  affected INT UNSIGNED NULL,
  UNIQUE KEY uq_job_date (job_name, run_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- P1 (push notification — M-PUSH, FSD §5.9, TRD §4.2)
CREATE TABLE IF NOT EXISTS device_tokens (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  platform ENUM('android', 'ios') NOT NULL,
  token VARCHAR(255) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_device_token (token),
  INDEX idx_device_user (user_id),
  CONSTRAINT fk_dev_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
