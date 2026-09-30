Here is how the architecture and workflow are designed to handle this in GovDrive:

1. Where the "Searchable" text is stored
When a scanned PDF or image is uploaded, it is sent to the CICOD data center's sovereign OCR pipeline.

The Text: The AI reads every page and stores the extracted text in a secure Vector Index (a specialized database for AI search).
Security: When it stores this text, it attaches the file's permission rules (ACL) to it. This guarantees that when a user searches for something, the AI only returns results from documents that the specific user has permission to open.
2. How the Metadata is handled
The AI also extracts key details from the document (like the reference number, subject, dates, parties involved, and detected signatures). However, it does not save this metadata automatically.

Instead, the workflow works like this:

The AI holds the extracted metadata in a pending state.
A records officer clicks the 3-dot menu and opens the AI Metadata Panel (what you see when you click "More Options" in the demo).
The officer reviews what the AI found, corrects any mistakes (like fixing a misread handwritten date), and clicks Accept.
Only then is the metadata officially saved into the standard GovDrive database and attached to the file record.
(Bonus): If the officer makes a correction, that feedback is automatically sent back to the AI so it learns to stop making that specific mistake in the future!
This "human-in-the-loop" approach ensures that your system's metadata remains 100% accurate while still doing 80% of the heavy lifting automatically.