// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
//! Trusted-main TimeAlert interoperability types; never registered as a module capability.
use super::school_data::SchoolDataDocument;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

macro_rules! model {
    ($(#[$meta:meta])* $name:ident { $($field:ident:$ty:ty),* $(,)? }) => {
        $(#[$meta])*
        #[derive(Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
        #[serde(rename_all="camelCase", deny_unknown_fields)]
        pub struct $name { $(#[doc=concat!("Trusted-main ", stringify!($field), " field.")] pub $field:$ty),* }
    };
}
model! { /// Short-lived password for a native backup picker. Never logged or retained by the session.
TimeAlertOpenArgs { password:String } }
model! { /// Exact original table counts without disclosing private row contents.
TimeAlertTableSummary { table_key:String, row_count:u32 } }
model! { /// Verified DB7 projection; unsupported original features remain in the private database.
TimeAlertPreview { session_handle:String, schema_version:u8, document:SchoolDataDocument, photo_count:u32, tables:Vec<TimeAlertTableSummary>, warnings:Vec<String> } }
model! { /// Explicit identity link; matching names alone never merge student masters.
TimeAlertStudentLink { imported_student_id:String, existing_student_id:String } }
model! { /// Adds the reviewed projection to school data, with optimistic concurrency protection.
TimeAlertApplyArgs { session_handle:String, expected_revision:u32, student_links:Vec<TimeAlertStudentLink> } }
model! { /// Exports saved data, with optional retained original database and a fresh encryption password.
TimeAlertExportArgs { session_handle:Option<String>, expected_revision:u32, password:String } }
model! { /// Releases exactly one opaque, host-owned session.
TimeAlertCloseArgs { session_handle:String } }
model! { /// Host-selected XLSX photo mapping. The shell supplies validated rows and explicit image keys.
TimeAlertRosterPhotoMatch { row_key:String, student_id:String, photo_key:String } }
model! { /// A ZIP-internal media part maps to an opaque host photo key, never an OS path.
TimeAlertRosterPhotoKey { part_key:String, photo_key:String, thumbnail_base64:Option<String> } }
model! { /// Native preview or confirmed application using the same main-only command.
TimeAlertRosterPhotosArgs { session_handle:Option<String>, semester_id:String, expected_revision:u32, matches:Vec<TimeAlertRosterPhotoMatch>, document:Option<SchoolDataDocument> } }
model! { /// Bounded XML only, with opaque photo keys; binary media and source paths remain in the host.
TimeAlertRosterPhotosPreview { session_handle:String, expected_revision:u32, workbook:super::school_data::SchoolWorkbookInput, photo_keys:Vec<TimeAlertRosterPhotoKey>, document:Option<SchoolDataDocument> } }
