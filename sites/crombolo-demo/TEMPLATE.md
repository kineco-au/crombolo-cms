## What is in it

- a site about Crombolo in English and Spanish: a home page for editors and a page for developers, both built from blocks, features filtered by category, a blog with tags and paging, an about page, search and a contact form;
- people kept in the Library, a menu in the header, a dictionary for the words the views print, and site settings in the footer;
- search and sharing details, a sitemap, and a language switch on every page.

The people and the quotes are invented, and every image is a screenshot of Crombolo itself.

## Where to look first

`components/blocks/` holds a view for each block, and `content/pages/home.toml` shows a page made of them. `schema/languages.toml` and `domains.toml` set up Spanish at `/es`, and `bunx crombolo types show blogPost` shows how a post is put together.
