-- Complete the initial seed before the first configuration save.
-- Match the entire legacy link list so customized entries remain untouched.
UPDATE site_settings
SET links_json='[{"id":"blog","title":"博客","url":"https://blog.nekro.top/","icon":"book","sortOrder":0,"visibility":"public","enabled":true},{"id":"projects","title":"项目","url":"https://github.com/ayyyyano","icon":"code","sortOrder":1,"visibility":"public","enabled":true},{"id":"home","title":"主页","url":"https://www.nekro.top/","icon":"home","sortOrder":2,"visibility":"public","enabled":true},{"id":"about","title":"关于","url":"https://blog.nekro.top/about/","icon":"person","sortOrder":3,"visibility":"public","enabled":true}]'
WHERE id=1 AND config_version=1 AND write_token IS NULL
  AND NOT EXISTS (SELECT 1 FROM integrations)
  AND json(links_json)=json('[{"id":"blog","title":"博客","url":"https://soki.moe/","icon":"book","sortOrder":0,"visibility":"public","enabled":true},{"id":"projects","title":"项目","url":"https://github.com/users/SokiSama/projects","icon":"code","sortOrder":1,"visibility":"public","enabled":true},{"id":"home","title":"我的家","url":"https://home.soki.moe/soki-home/home","icon":"home","sortOrder":2,"visibility":"public","enabled":true},{"id":"about","title":"关于","url":"https://soki.moe/about","icon":"person","sortOrder":3,"visibility":"public","enabled":true}]');
