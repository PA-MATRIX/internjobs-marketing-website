-- migration: 0010_brightdata_linkedin_default
-- description: Bright Data is the only LinkedIn enrichment provider.

alter table linkedin_profiles
  alter column enriched_via set default 'brightdata_linkedin_url';

update profile_enrichment_jobs
   set provider = 'brightdata',
       updated_at = now()
 where provider = 'sprite_brightdata';
