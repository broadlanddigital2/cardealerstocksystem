-- After copying files from the old Replit bucket into Supabase Storage
-- (bucket "stock-book", key "uploads/<id>"), run this once in the Supabase SQL
-- editor. It registers every file the data already references (dealer logo,
-- vehicle showroom photos, showroom feature icons) as public-read, matching the
-- ACL the Replit app stored as object metadata.
insert into stored_objects (object_id, owner, visibility)
select distinct substring(p from '^/objects/uploads/(.+)$'), user_id, 'public'
from (
  select user_id, logo_path as p from dealer_settings
  union all
  select user_id, jsonb_array_elements_text(photo_urls)
    from vehicles where jsonb_typeof(photo_urls) = 'array'
  union all
  select user_id, f ->> 'iconPath'
    from dealer_settings, jsonb_array_elements(showroom_features) f
    where jsonb_typeof(showroom_features) = 'array'
) refs
where p like '/objects/uploads/%'
on conflict (object_id) do nothing;
