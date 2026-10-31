# Plain Signal demo site — image credits

The Plain Signal site is distributed (`"distribute": true` in its `site.json`),
so it is staged into `@crombolo/cli`'s `templates/` when the CLI is packed, and
every image in its seed is **redistributed** to anyone who runs
`crombolo init --template demo/plain-signal`. Each one therefore needs a
recorded source and licence, and `tests/packaging.test.ts` asserts that none is
missing from this file.

Every image is from Wikimedia Commons, chosen on 31 October 2026, its licence
read from its file page there. Only licences that allow redistribution are
used: public domain and Creative Commons Attribution. Each was resized to at
most 1,600 pixels wide and saved as JPEG; nothing else was changed.

| File | Source | Licence | Attribution |
| --- | --- | --- | --- |
| `seed/media/hurricane-florence-from-the-iss.jpg` | [Hurricane Florence Viewed from the Space Station](https://commons.wikimedia.org/wiki/File:Hurricane_Florence_Viewed_from_the_Space_Station.jpg) | Public domain | NASA |
| `seed/media/mammogram.jpg` | [Mammogram](https://commons.wikimedia.org/wiki/File:Mammogram.jpg) | Public domain | US National Cancer Institute |
| `seed/media/utah-electrode-array.jpg` | [Utah array pat5215088](https://commons.wikimedia.org/wiki/File:Utah_array_pat5215088.jpg) | Public domain | Richard A. Normann, US Patent 5,215,088 |
| `seed/media/mrsa-bacteria.jpg` | [Methicillin-Resistant Staphylococcus Aureus (MRSA) Bacteria colorized scanning electron micrograph - 22](https://commons.wikimedia.org/wiki/File:Methicillin-Resistant_Staphylococcus_Aureus_(MRSA)_Bacteria_colorized_scanning_electron_micrograph_-_22.jpg) | [CC BY 2.0](https://creativecommons.org/licenses/by/2.0) | NIAID |
| `seed/media/euclid-elements-page.jpg` | [Euclid, Elements 10, appendix](https://commons.wikimedia.org/wiki/File:Euclid,_Elements_10,_appendix.jpg) | Public domain | Euclid (a facsimile of a historical edition) |
| `seed/media/triose-phosphate-isomerase-ribbon.jpg` | [TriosePhosphateIsomerase Ribbon pastel](https://commons.wikimedia.org/wiki/File:TriosePhosphateIsomerase_Ribbon_pastel.png) | [CC BY 3.0](https://creativecommons.org/licenses/by/3.0) | Dcrjsr |

Each article states its image's credit beneath the picture, as the
attribution licences ask.

## The stories

The six articles report real research, each naming its sources at the end. The
publication, its staff and its readers are not real.
