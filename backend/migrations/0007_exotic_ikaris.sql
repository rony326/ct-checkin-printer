PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_media_types` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`vendor` text NOT NULL,
	`external_id` text NOT NULL,
	`name` text NOT NULL,
	`width_mm` integer NOT NULL,
	`height_mm` integer,
	`printable_width_mm` real NOT NULL,
	`printable_height_mm` real,
	`die_cut` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_media_types`("id", "vendor", "external_id", "name", "width_mm", "height_mm", "printable_width_mm", "printable_height_mm", "die_cut") SELECT "id", "vendor", "external_id", "name", "width_mm", "height_mm", "printable_width_mm", "printable_height_mm", "die_cut" FROM `media_types`;--> statement-breakpoint
DROP TABLE `media_types`;--> statement-breakpoint
ALTER TABLE `__new_media_types` RENAME TO `media_types`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
-- Korrigiert bereits (vor diesem Fix) geseedete Zeilen: seed.ts hat
-- printable_width_mm/printable_height_mm bisher auf ganze mm gerundet
-- (Math.round), wodurch der Rücktransport in Pixel beim Rendern nicht mehr
-- exakt auf brother_ql's ALL_LABELS-dots_printable traf ("Bad image
-- dimensions" beim Druck von Die-Cut-Etiketten, z.B. DK-11234 60x86:
-- 672px wurden durch die Rundung auf 57mm zu 673px). Selbst eine Rundung auf
-- 0.1mm reicht nicht in jedem Fall (Doppelrundung px->mm->px kann bei
-- einzelnen Formaten trotzdem ±1px abweichen) — hier stehen daher die vollen
-- Fliesskomma-Werte, exakt wie sie jetzt auch brotherMedia.ts liefert (siehe
-- dortigen Kommentar). media_types ist rein systemseitig geseedet (kein
-- Edit-Endpunkt), daher hier gefahrlos per external_id korrigierbar.
UPDATE `media_types` SET `printable_width_mm` = 8.974666666666666, `printable_height_mm` = NULL WHERE `external_id` = '12' AND `vendor` = 'brother-ql';--> statement-breakpoint
UPDATE `media_types` SET `printable_width_mm` = 25.907999999999998, `printable_height_mm` = NULL WHERE `external_id` = '29' AND `vendor` = 'brother-ql';--> statement-breakpoint
UPDATE `media_types` SET `printable_width_mm` = 34.96733333333333, `printable_height_mm` = NULL WHERE `external_id` = '38' AND `vendor` = 'brother-ql';--> statement-breakpoint
UPDATE `media_types` SET `printable_width_mm` = 46.90533333333333, `printable_height_mm` = NULL WHERE `external_id` = '50' AND `vendor` = 'brother-ql';--> statement-breakpoint
UPDATE `media_types` SET `printable_width_mm` = 49.953333333333326, `printable_height_mm` = NULL WHERE `external_id` = '54' AND `vendor` = 'brother-ql';--> statement-breakpoint
UPDATE `media_types` SET `printable_width_mm` = 58.92799999999999, `printable_height_mm` = NULL WHERE `external_id` = '62' AND `vendor` = 'brother-ql';--> statement-breakpoint
UPDATE `media_types` SET `printable_width_mm` = 58.92799999999999, `printable_height_mm` = NULL WHERE `external_id` = '62red' AND `vendor` = 'brother-ql';--> statement-breakpoint
UPDATE `media_types` SET `printable_width_mm` = 98.55199999999999, `printable_height_mm` = NULL WHERE `external_id` = '102' AND `vendor` = 'brother-ql';--> statement-breakpoint
UPDATE `media_types` SET `printable_width_mm` = 101.6, `printable_height_mm` = NULL WHERE `external_id` = '103' AND `vendor` = 'brother-ql';--> statement-breakpoint
UPDATE `media_types` SET `printable_width_mm` = 13.97, `printable_height_mm` = 47.92133333333333 WHERE `external_id` = '17x54' AND `vendor` = 'brother-ql';--> statement-breakpoint
UPDATE `media_types` SET `printable_width_mm` = 13.97, `printable_height_mm` = 80.94133333333332 WHERE `external_id` = '17x87' AND `vendor` = 'brother-ql';--> statement-breakpoint
UPDATE `media_types` SET `printable_width_mm` = 17.102666666666664, `printable_height_mm` = 17.102666666666664 WHERE `external_id` = '23x23' AND `vendor` = 'brother-ql';--> statement-breakpoint
UPDATE `media_types` SET `printable_width_mm` = 25.907999999999998, `printable_height_mm` = 35.983333333333334 WHERE `external_id` = '29x42' AND `vendor` = 'brother-ql';--> statement-breakpoint
UPDATE `media_types` SET `printable_width_mm` = 25.907999999999998, `printable_height_mm` = 83.90466666666666 WHERE `external_id` = '29x90' AND `vendor` = 'brother-ql';--> statement-breakpoint
UPDATE `media_types` SET `printable_width_mm` = 34.96733333333333, `printable_height_mm` = 83.90466666666666 WHERE `external_id` = '39x90' AND `vendor` = 'brother-ql';--> statement-breakpoint
UPDATE `media_types` SET `printable_width_mm` = 35.983333333333334, `printable_height_mm` = 41.91 WHERE `external_id` = '39x48' AND `vendor` = 'brother-ql';--> statement-breakpoint
UPDATE `media_types` SET `printable_width_mm` = 48.937333333333335, `printable_height_mm` = 22.944666666666667 WHERE `external_id` = '52x29' AND `vendor` = 'brother-ql';--> statement-breakpoint
UPDATE `media_types` SET `printable_width_mm` = 56.896, `printable_height_mm` = 80.772 WHERE `external_id` = '60x86' AND `vendor` = 'brother-ql';--> statement-breakpoint
UPDATE `media_types` SET `printable_width_mm` = 58.92799999999999, `printable_height_mm` = 22.944666666666667 WHERE `external_id` = '62x29' AND `vendor` = 'brother-ql';--> statement-breakpoint
UPDATE `media_types` SET `printable_width_mm` = 58.92799999999999, `printable_height_mm` = 93.89533333333333 WHERE `external_id` = '62x100' AND `vendor` = 'brother-ql';--> statement-breakpoint
UPDATE `media_types` SET `printable_width_mm` = 98.55199999999999, `printable_height_mm` = 44.534666666666666 WHERE `external_id` = '102x51' AND `vendor` = 'brother-ql';--> statement-breakpoint
UPDATE `media_types` SET `printable_width_mm` = 98.55199999999999, `printable_height_mm` = 140.54666666666665 WHERE `external_id` = '102x152' AND `vendor` = 'brother-ql';--> statement-breakpoint
UPDATE `media_types` SET `printable_width_mm` = 101.6, `printable_height_mm` = 154.26266666666666 WHERE `external_id` = '103x164' AND `vendor` = 'brother-ql';--> statement-breakpoint
UPDATE `media_types` SET `printable_width_mm` = 7.958666666666667, `printable_height_mm` = 7.958666666666667 WHERE `external_id` = 'd12' AND `vendor` = 'brother-ql';--> statement-breakpoint
UPDATE `media_types` SET `printable_width_mm` = 19.981333333333332, `printable_height_mm` = 19.981333333333332 WHERE `external_id` = 'd24' AND `vendor` = 'brother-ql';--> statement-breakpoint
UPDATE `media_types` SET `printable_width_mm` = 52.324, `printable_height_mm` = 52.324 WHERE `external_id` = 'd58' AND `vendor` = 'brother-ql';
