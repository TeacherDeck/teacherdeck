// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// Category icons and display order shared by the navigation rail and the deck home.
import { DocumentRegular, FolderRegular, ImageRegular, PeopleTeamRegular, WrenchRegular } from "@fluentui/react-icons";
import type { ReactElement } from "react";
import type { Category } from "./generated/Category.ts";

/** Order of category sections on the deck home and in the rail. */
export const CATEGORY_ORDER: readonly Category[] = ["classroom", "file", "image", "document", "utility"];

export const CATEGORY_ICONS: Record<Category, ReactElement> = {
  classroom: <PeopleTeamRegular />,
  file: <FolderRegular />,
  image: <ImageRegular />,
  document: <DocumentRegular />,
  utility: <WrenchRegular />,
};
