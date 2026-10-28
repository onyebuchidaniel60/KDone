# KDone — External Source of Truth: Amazon KDP

These are the official Amazon/KDP sources that should be consulted whenever KDone behavior depends on current KDP rules.

## Content and AI

### Content Guidelines

https://kdp.amazon.com/en_US/help/topic/G200672390

Use for:

- AI-generated content disclosure
- intellectual-property/rightsholder requirements
- content restrictions
- poor customer experience requirements

Current key rule: Amazon requires disclosure of AI-generated text, images, or translations when publishing a new book or republishing edits through KDP. AI-assisted content does not require disclosure. Amazon says the publisher remains responsible for compliance. 

## Metadata

### Metadata Guidelines for Books

https://kdp.amazon.com/en_US/help/topic/G201097560

Use for:

- descriptions
- keywords
- author/contributor fields
- publisher field
- metadata restrictions

### Books Titles & Editions

https://kdp.amazon.com/en_US/help/topic/GW7J4WEKBVU25YEC

Use for:

- title/subtitle rules
- edition handling
- title/cover consistency

### KDP Categories

https://kdp.amazon.com/en_US/help/topic/G200652170

Use for:

- category selection
- category accuracy
- current category selection process

Amazon currently allows authors to select three categories for a book and emphasizes that categories must accurately describe the book.

### Book Detail Resources

https://kdp.amazon.com/en_US/help/topic/G202105800

Use for the authoritative set of book-detail/metadata help pages.

## Upload, EPUB, preview, and quality

### Cover Specifications

https://kdp.amazon.com/en_US/help/topic/G200645690

Use for:

- eBook cover format and dimensions
- color mode, resolution, and file-size limits
- cover/text consistency

Current key rule (verified 2026-10-28): eBook covers must be **TIFF or JPEG**, 1600×2560 pixels, 1.6:1 aspect ratio, 72 dpi, RGB, and under 50 MB. PNG and SVG are not accepted. The deterministic renderer therefore stores JPEG and keeps SVG only as its internal layout source (ADR-023).

### Upload and Preview Book Content

https://kdp.amazon.com/en_US/help/topic/G200641240

Use for:

- manuscript upload workflow
- Online Previewer
- quality checks
- EPUB/preview troubleshooting

### Upload Book Resources

https://kdp.amazon.com/en_US/help/topic/G202175860

Use for current file/setup requirements for ebook, paperback, and hardcover workflows.

### Kindle Publishing Guidelines

https://kdp.amazon.com/en_US/help/topic/GU72M65VRFPH43L6

Use for:

- reflowable ebook structure
- navigation
- HTML/CSS
- hyperlinks
- accessibility
- QA
- cover/image guidance

### Guide to Kindle Content Quality

https://kdp.amazon.com/en_US/help/topic/G200952510

Use for:

- quality expectations
- common critical issues
- reader experience requirements

## Change-management rule

These links are external sources of truth. If an Amazon rule changes, update KDone's implementation/validation behavior and record the change in `docs/DECISIONS.md` and `docs/AI_HANDOFF.md`.

Do not copy large amounts of Amazon text into the codebase. Keep concise internal interpretations and link back to the authoritative source.
