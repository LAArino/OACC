-- SPDX-License-Identifier: EUPL-1.2
-- 0002_seed_reference: ISCED-F 2013 broad fields (00-10, 99) for isced_broad_fields,
-- with English labels. Organizations are seeded by `oecp seed-organizations`, not here.

-- Up Migration
INSERT INTO isced_broad_fields (code, label) VALUES
  ('00', '{"en": "Generic programmes and qualifications"}'),
  ('01', '{"en": "Education"}'),
  ('02', '{"en": "Arts and humanities"}'),
  ('03', '{"en": "Social sciences, journalism and information"}'),
  ('04', '{"en": "Business, administration and law"}'),
  ('05', '{"en": "Natural sciences, mathematics and statistics"}'),
  ('06', '{"en": "Information and Communication Technologies (ICTs)"}'),
  ('07', '{"en": "Engineering, manufacturing and construction"}'),
  ('08', '{"en": "Agriculture, forestry, fisheries and veterinary"}'),
  ('09', '{"en": "Health and welfare"}'),
  ('10', '{"en": "Services"}'),
  ('99', '{"en": "Field unknown"}')
ON CONFLICT (code) DO UPDATE SET label = EXCLUDED.label;

-- Down Migration
DELETE FROM isced_broad_fields
WHERE code IN ('00','01','02','03','04','05','06','07','08','09','10','99');
