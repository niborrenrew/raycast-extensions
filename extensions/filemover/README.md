# Filemover

Filemover is a highly efficient Raycast extension that allows you to instantly move or copy currently selected files in Finder (or your Desktop) to predefined or custom folders without taking your hands off the keyboard.

## Features

- **System-Wide Detection:** Automatically detects any selected files in macOS Finder or on your Desktop. No need to pass files manually.
- **Smart Duplicate Handling:** Safely handles filename conflicts. If a file already exists in the destination folder, Filemover automatically appends a number (e.g., `(1)`) to the new file, ensuring your workflow is never interrupted by error popups.
- **Favorites & Recents:** Add your most-used folders to Favorites, or just let Filemover track your 4 most recently used folders for lightning-fast repetitive sorting.
- **Move or Copy:** Press `Enter` to move files, or use `Cmd + D` to copy them instead.
- **Create New Folders:** Hit `Cmd + N` to create a brand new directory on-the-fly and move your files directly into it.
- **Custom Destinations:** Use `Cmd + Shift + F` to pick any one-off destination folder from your system.
- **Detailed Preview:** Always see exactly which files are queued up in the Raycast detail view before confirming the move.

## Usage

1. Select one or multiple files in Finder or on your Desktop.
2. Open Raycast and run the `Filemover` command.
3. The extension will display your Favorite, Recent, and Default (Downloads, Desktop, Documents) folders.
4. Highlight a target folder and press:
   - `Enter` to Move
   - `Cmd + D` to Copy
   - `Cmd + Shift + F` to pick a custom folder
   - `Cmd + N` to create a new folder and move the files there

## Setup

No advanced setup required! The extension works natively with macOS File System APIs. You can start adding your own Favorite directories right from the Raycast Action Menu (`Cmd + K`).

Enjoy a clutter-free Desktop!
