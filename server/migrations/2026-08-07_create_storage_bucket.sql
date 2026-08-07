-- Cat Frame — the photo bucket
--
-- Run in the Supabase SQL editor, or:
--   psql "$DIRECT_URL" -f migrations/2026-08-07_create_storage_bucket.sql

-- ---------------------------------------------------------------------------
-- The bucket
-- ---------------------------------------------------------------------------
--
-- Public, with unguessable paths. That is a real trade and worth stating plainly: anyone
-- holding a URL can fetch the image without a session, so a photo's privacy rests on nobody
-- being given the URL rather than on a check at read time.
--
-- It is the right trade here. The album is a grid of two hundred thumbnails, and a private
-- bucket means two hundred signed URLs with expiries to mint, cache and re-mint every time
-- one lapses — per screen, per scroll, per player. Photos of a cat on a wall are also not
-- the kind of secret that justifies it. Paths carry a uuid, so a URL cannot be guessed or
-- walked, and going public → private later is a policy change while the reverse is a
-- migration plus everything already leaked.
--
-- Writes are a different matter entirely, and are locked down below.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'cat-photos',
  'cat-photos',
  true,

  -- 10 MB. Generous for a downscaled capture and small enough that a client bug cannot
  -- fill the bucket one request at a time. Enforced by storage itself, before any of our
  -- code sees the upload.
  10485760,

  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- Who may write
-- ---------------------------------------------------------------------------
--
-- Every object lives at `<user_id>/<uuid>.jpg`, and the policies compare that first folder
-- against the caller's own id. So a player writes into their own folder and nowhere else,
-- which is what makes it safe for the phone to upload directly instead of streaming the
-- bytes through our server.
--
-- `storage.foldername(name)` splits the object path; element 1 is the first segment.

create policy "players upload into their own folder"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'cat-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- Replacing a file, which an upsert on retry needs.
create policy "players replace their own photos"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'cat-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'cat-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "players delete their own photos"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'cat-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- Listing your own folder. Reading an image does not need this — a public bucket serves
-- /object/public/... without consulting a policy at all — but enumerating what is in a
-- folder does, and enumeration is the one thing that should stay private.
create policy "players list their own folder"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'cat-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- Confirm:
--
--   select id, public, file_size_limit from storage.buckets where id = 'cat-photos';
--   select policyname from pg_policies
--   where schemaname = 'storage' and tablename = 'objects';
--
-- Expect the bucket public with a 10 MB limit, and four policies.
