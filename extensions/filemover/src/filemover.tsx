import {
  ActionPanel,
  List,
  Action,
  Icon,
  getSelectedFinderItems,
  LocalStorage,
  showToast,
  Toast,
  popToRoot,
  closeMainWindow,
  Form,
  useNavigation,
} from "@raycast/api";
import { useEffect, useState } from "react";
import * as os from "os";
import * as path from "path";
import * as fs from "fs";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);
const DEFAULT_FOLDERS = [
  {
    name: "Desktop",
    path: path.join(os.homedir(), "Desktop"),
    icon: Icon.Desktop,
  },
  {
    name: "Documents",
    path: path.join(os.homedir(), "Documents"),
    icon: Icon.Document,
  },
  {
    name: "Downloads",
    path: path.join(os.homedir(), "Downloads"),
    icon: Icon.Download,
  },
];

export default function Command() {
  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);
  const [favorites, setFavorites] = useState<{ name: string; path: string }[]>([]);
  const [recents, setRecents] = useState<{ name: string; path: string }[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [searchText, setSearchText] = useState("");
  const [searchResults, setSearchResults] = useState<{ name: string; path: string }[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedItemId, setSelectedItemId] = useState<string | undefined>();

  useEffect(() => {
    async function fetchSelectedFiles() {
      try {
        const items = await getSelectedFinderItems();
        const paths = items.map((item) => item.path);
        setSelectedFiles((prev) => {
          if (JSON.stringify(prev) !== JSON.stringify(paths)) return paths;
          return prev;
        });
      } catch {
        setSelectedFiles((prev) => (prev.length > 0 ? [] : prev));
      }
    }

    async function init() {
      await fetchSelectedFiles();

      const storedFavorites = await LocalStorage.getItem<string>("favorites");
      if (storedFavorites) {
        try {
          setFavorites(JSON.parse(storedFavorites));
        } catch {
          await LocalStorage.removeItem("favorites");
        }
      }

      const storedRecents = await LocalStorage.getItem<string>("recents");
      if (storedRecents) {
        try {
          const parsedRecents = JSON.parse(storedRecents);
          setRecents(parsedRecents.slice(0, 4));
        } catch {
          await LocalStorage.removeItem("recents");
        }
      }

      setIsLoading(false);
    }
    init();

    const syncInterval = setInterval(fetchSelectedFiles, 1000);
    return () => clearInterval(syncInterval);
  }, []);

  useEffect(() => {
    if (searchText.length < 3) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    const delayDebounceFn = setTimeout(async () => {
      try {
        const safeQuery = searchText.replace(/["']/g, "");
        if (!safeQuery) {
          setSearchResults([]);
          setIsSearching(false);
          setSelectedItemId(undefined);
          return;
        }
        const predicate = `kMDItemContentType == "public.folder" && kMDItemDisplayName == "*${safeQuery}*"cd`;
        const { stdout } = await execFileAsync("mdfind", ["-onlyin", os.homedir(), predicate]);
        const allPaths = stdout.split("\n").filter(Boolean);
        const filteredPaths = allPaths
          .filter((p) => !p.includes("/Library/") && !p.includes("node_modules") && !p.includes(".git"))
          .slice(0, 15);
        const newResults = filteredPaths.map((p) => ({ name: path.basename(p), path: p }));
        setSearchResults(newResults);
        if (newResults.length > 0) {
          setSelectedItemId("search-0");
        } else {
          setSelectedItemId(undefined);
        }
      } catch {
        setSearchResults([]);
        setSelectedItemId(undefined);
      } finally {
        setIsSearching(false);
      }
    }, 400);

    return () => clearTimeout(delayDebounceFn);
  }, [searchText]);

  async function updateRecents(folderName: string, folderPath: string) {
    const filtered = recents.filter((r) => r.path !== folderPath);
    const updated = [{ name: folderName, path: folderPath }, ...filtered].slice(0, 4);
    setRecents(updated);
    await LocalStorage.setItem("recents", JSON.stringify(updated));
  }

  async function safeMoveOrCopy(files: string[], destFolder: string, isCopy: boolean) {
    if (!fs.existsSync(destFolder)) {
      await fs.promises.mkdir(destFolder, { recursive: true });
    }

    let processedCount = 0;
    for (const src of files) {
      try {
        const basename = path.basename(src);
        let safeName = basename;
        let counter = 1;
        let destPath = path.join(destFolder, safeName);

        if (src === destPath) continue;

        while (fs.existsSync(destPath)) {
          const ext = path.extname(basename);
          const name = path.basename(basename, ext);
          safeName = `${name} (${counter})${ext}`;
          destPath = path.join(destFolder, safeName);
          counter++;
        }

        if (isCopy) {
          await fs.promises.cp(src, destPath, { recursive: true });
        } else {
          try {
            await fs.promises.rename(src, destPath);
          } catch (error) {
            const e = error as NodeJS.ErrnoException;
            if (e.code === "EXDEV") {
              await fs.promises.cp(src, destPath, { recursive: true });
              try {
                await fs.promises.rm(src, { recursive: true });
              } catch (rmError) {
                throw new Error(`File copied to destination, but failed to remove original: ${rmError}`);
              }
            } else {
              throw e;
            }
          }
        }
        processedCount++;
      } catch (e) {
        throw new Error(
          `Partial failure: ${processedCount} of ${files.length} files successfully processed before error. Check destination folder. Underlying error: ${
            e instanceof Error ? e.message : String(e)
          }`,
        );
      }
    }
  }

  async function handleAction(destinationPath: string, folderName: string, isCopy: boolean) {
    if (selectedFiles.length === 0) {
      await showToast({
        style: Toast.Style.Failure,
        title: "No files selected",
        message: "Please select files in Finder first.",
      });
      return;
    }

    try {
      await safeMoveOrCopy(selectedFiles, destinationPath, isCopy);
      await updateRecents(folderName, destinationPath);
      await showToast({
        style: Toast.Style.Success,
        title: `Files ${isCopy ? "copied" : "moved"} successfully`,
      });
      await closeMainWindow();
      await popToRoot();
    } catch (e) {
      await showToast({
        style: Toast.Style.Failure,
        title: `Failed to ${isCopy ? "copy" : "move"} files`,
        message: String(e),
      });
    }
  }

  async function addFavorite(name: string, folderPath: string) {
    const newFavorites = [...favorites, { name, path: folderPath }];
    setFavorites(newFavorites);
    await LocalStorage.setItem("favorites", JSON.stringify(newFavorites));
    await showToast({ title: "Added to favorites" });
  }

  async function removeFavorite(folderPath: string) {
    const newFavorites = favorites.filter((f) => f.path !== folderPath);
    setFavorites(newFavorites);
    await LocalStorage.setItem("favorites", JSON.stringify(newFavorites));
    await showToast({ title: "Removed from favorites" });
  }

  async function clearRecents() {
    setRecents([]);
    await LocalStorage.removeItem("recents");
    await showToast({ title: "Recent folders cleared" });
  }

  const fileCount = selectedFiles.length;
  const subtitle = fileCount > 0 ? `${fileCount} file(s) selected` : "No files selected";

  const detailMarkdown =
    selectedFiles.length > 0
      ? `### Files to Move / Copy\n\n${selectedFiles
          .map((f) => `- **${path.basename(f)}**\n  \n  \`${f}\``)
          .join("\n\n")}`
      : `### No files selected.\n\nOpen Finder and select files to move or copy them, or use this extension to manage your favorites.`;

  function getFolderDetail(folderPath: string) {
    return (
      <List.Item.Detail
        markdown={detailMarkdown}
        metadata={
          <List.Item.Detail.Metadata>
            <List.Item.Detail.Metadata.Label title="Destination" text={folderPath} />
          </List.Item.Detail.Metadata>
        }
      />
    );
  }

  // FolderActionPanel has been extracted to module level to avoid re-mounting on every render

  return (
    <List
      selectedItemId={selectedItemId}
      onSelectionChange={(id) => {
        if (id !== selectedItemId) setSelectedItemId(id || undefined);
      }}
      isLoading={isLoading || isSearching}
      searchText={searchText}
      onSearchTextChange={setSearchText}
      searchBarPlaceholder="Search lists or find directories..."
      isShowingDetail={fileCount > 0}
    >
      {fileCount === 0 && (
        <List.EmptyView
          title="No files selected"
          description="Select files in Finder or on your Desktop to move them."
          icon={Icon.Document}
        />
      )}

      {!isLoading && (
        <>
          {searchResults.length > 0 && (
            <List.Section title="Search Results">
              {searchResults.map((folder, index) => (
                <List.Item
                  key={`search-${index}`}
                  id={`search-${index}`}
                  title={folder.name}
                  subtitle={folder.path}
                  icon={Icon.Folder}
                  accessories={[{ text: path.dirname(folder.path), tooltip: folder.path }]}
                  detail={getFolderDetail(folder.path)}
                  actions={
                    <FolderActionPanel
                      folder={folder}
                      fileCount={fileCount}
                      favorites={favorites}
                      onAddFavorite={addFavorite}
                      onRemoveFavorite={removeFavorite}
                      onClearRecents={clearRecents}
                      onAction={handleAction}
                    />
                  }
                />
              ))}
            </List.Section>
          )}

          <List.Section title="Favorites" subtitle={subtitle}>
            {favorites.map((fav, index) => (
              <List.Item
                key={`fav-${index}`}
                title={fav.name}
                subtitle={fav.path}
                icon={Icon.Star}
                accessories={[{ text: path.dirname(fav.path), tooltip: fav.path }]}
                detail={getFolderDetail(fav.path)}
                actions={
                  <FolderActionPanel
                    folder={fav}
                    fileCount={fileCount}
                    favorites={favorites}
                    onAddFavorite={addFavorite}
                    onRemoveFavorite={removeFavorite}
                    onClearRecents={clearRecents}
                    onAction={handleAction}
                  />
                }
              />
            ))}
          </List.Section>

          {recents.length > 0 && (
            <List.Section title="Recent Folders" subtitle={favorites.length === 0 ? subtitle : ""}>
              {recents.map((folder, index) => (
                <List.Item
                  key={`recent-${index}`}
                  title={folder.name}
                  subtitle={folder.path}
                  icon={Icon.Clock}
                  accessories={[{ text: path.dirname(folder.path), tooltip: folder.path }]}
                  detail={getFolderDetail(folder.path)}
                  actions={
                    <FolderActionPanel
                      folder={folder}
                      isRecent={true}
                      fileCount={fileCount}
                      favorites={favorites}
                      onAddFavorite={addFavorite}
                      onRemoveFavorite={removeFavorite}
                      onClearRecents={clearRecents}
                      onAction={handleAction}
                    />
                  }
                />
              ))}
            </List.Section>
          )}

          <List.Section title="Default Folders">
            {DEFAULT_FOLDERS.map((folder, index) => (
              <List.Item
                key={`def-${index}`}
                title={folder.name}
                subtitle={folder.path}
                icon={folder.icon}
                detail={<List.Item.Detail markdown={detailMarkdown} />}
                actions={
                  <ActionPanel>
                    <Action
                      title="Move Files Here"
                      icon={Icon.ArrowRight}
                      onAction={() => handleAction(folder.path, folder.name, false)}
                    />
                    <Action
                      title="Copy Files Here"
                      icon={Icon.CopyClipboard}
                      onAction={() => handleAction(folder.path, folder.name, true)}
                      shortcut={{ modifiers: ["cmd"], key: "d" }}
                    />
                    <Action.Push
                      title="Move to New Folder…"
                      icon={Icon.NewFolder}
                      target={<MoveToNewFolderForm onAction={handleAction} />}
                      shortcut={{ modifiers: ["cmd"], key: "n" }}
                    />
                    <Action.Push
                      title="Move to Custom Folder…"
                      icon={Icon.Folder}
                      target={<MoveToCustomFolderForm onAction={handleAction} />}
                      shortcut={{ modifiers: ["cmd", "shift"], key: "f" }}
                    />
                    <Action.Push
                      title="Add New Favorite…"
                      icon={Icon.Plus}
                      target={<AddFavoriteForm onAddFavorite={addFavorite} />}
                      shortcut={{ modifiers: ["cmd", "shift"], key: "n" }}
                    />
                  </ActionPanel>
                }
              />
            ))}
            {favorites.length === 0 && (
              <List.Item
                title="Add New Favorite…"
                icon={Icon.Plus}
                detail={<List.Item.Detail markdown={detailMarkdown} />}
                actions={
                  <ActionPanel>
                    <Action.Push
                      title="Add New Favorite…"
                      icon={Icon.Plus}
                      target={<AddFavoriteForm onAddFavorite={addFavorite} />}
                    />
                  </ActionPanel>
                }
              />
            )}
          </List.Section>
        </>
      )}
    </List>
  );
}

// Extracted FolderActionPanel & Forms to module level to prevent re-mounting on every render

interface FolderActionPanelProps {
  folder: { name: string; path: string };
  isRecent?: boolean;
  fileCount: number;
  favorites: { name: string; path: string }[];
  onAddFavorite: (name: string, folderPath: string) => Promise<void>;
  onRemoveFavorite: (folderPath: string) => Promise<void>;
  onClearRecents: () => Promise<void>;
  onAction: (destinationPath: string, folderName: string, isCopy: boolean) => Promise<void>;
}

function FolderActionPanel({
  folder,
  isRecent,
  fileCount,
  favorites,
  onAddFavorite,
  onRemoveFavorite,
  onClearRecents,
  onAction,
}: FolderActionPanelProps) {
  if (fileCount === 0) {
    return (
      <ActionPanel>
        <Action.Push
          title="Add to Favorites"
          icon={Icon.Star}
          target={<AddFavoriteForm onAddFavorite={onAddFavorite} />}
        />
        <Action.Push
          title="Move to Custom Folder…"
          icon={Icon.Folder}
          target={<MoveToCustomFolderForm onAction={onAction} />}
          shortcut={{ modifiers: ["cmd", "shift"], key: "f" }}
        />
        {favorites.some((f) => f.path === folder.path) && (
          <Action
            title="Remove from Favorites"
            icon={Icon.Trash}
            onAction={() => onRemoveFavorite(folder.path)}
            style={Action.Style.Destructive}
            shortcut={{ modifiers: ["ctrl"], key: "x" }}
          />
        )}
        {isRecent && (
          <Action
            title="Clear All Recents"
            icon={Icon.Trash}
            onAction={onClearRecents}
            style={Action.Style.Destructive}
            shortcut={{ modifiers: ["ctrl", "shift"], key: "x" }}
          />
        )}
      </ActionPanel>
    );
  }

  return (
    <ActionPanel>
      <Action
        title="Move Files Here"
        icon={Icon.ArrowRight}
        onAction={() => onAction(folder.path, folder.name, false)}
      />
      <Action
        title="Copy Files Here"
        icon={Icon.CopyClipboard}
        onAction={() => onAction(folder.path, folder.name, true)}
        shortcut={{ modifiers: ["cmd"], key: "d" }}
      />
      <Action.Push
        title="Move to New Folder…"
        icon={Icon.NewFolder}
        target={<MoveToNewFolderForm onAction={onAction} />}
        shortcut={{ modifiers: ["cmd"], key: "n" }}
      />
      <Action.Push
        title="Move to Custom Folder…"
        icon={Icon.Folder}
        target={<MoveToCustomFolderForm onAction={onAction} />}
        shortcut={{ modifiers: ["cmd", "shift"], key: "f" }}
      />
      <Action.Push
        title="Add to Favorites"
        icon={Icon.Star}
        target={<AddFavoriteForm onAddFavorite={onAddFavorite} />}
        shortcut={{ modifiers: ["cmd", "shift"], key: "a" }}
      />
      {favorites.some((f) => f.path === folder.path) && (
        <Action
          title="Remove from Favorites"
          icon={Icon.Trash}
          onAction={() => onRemoveFavorite(folder.path)}
          style={Action.Style.Destructive}
          shortcut={{ modifiers: ["ctrl"], key: "x" }}
        />
      )}
      {isRecent && (
        <Action
          title="Clear All Recents"
          icon={Icon.Trash}
          onAction={onClearRecents}
          style={Action.Style.Destructive}
          shortcut={{ modifiers: ["ctrl", "shift"], key: "x" }}
        />
      )}
    </ActionPanel>
  );
}

interface AddFavoriteFormProps {
  onAddFavorite: (name: string, folderPath: string) => Promise<void>;
}

function AddFavoriteForm({ onAddFavorite }: AddFavoriteFormProps) {
  const { pop } = useNavigation();

  return (
    <Form
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="Add Favorite"
            onSubmit={async (values: { name: string; folder: string[] }) => {
              if (values.folder.length > 0 && values.name) {
                await onAddFavorite(values.name, values.folder[0]);
                pop();
              } else {
                await showToast({
                  style: Toast.Style.Failure,
                  title: "Please fill all fields",
                });
              }
            }}
          />
        </ActionPanel>
      }
    >
      <Form.TextField id="name" title="Name" placeholder="e.g. Work Projects" />
      <Form.FilePicker
        id="folder"
        title="Folder"
        allowMultipleSelection={false}
        canChooseDirectories={true}
        canChooseFiles={false}
      />
    </Form>
  );
}

interface MoveToCustomFolderFormProps {
  onAction: (destinationPath: string, folderName: string, isCopy: boolean) => Promise<void>;
}

function MoveToCustomFolderForm({ onAction }: MoveToCustomFolderFormProps) {
  const { pop } = useNavigation();

  return (
    <Form
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="Move / Copy Files"
            onSubmit={async (values: { folder: string[]; copy: boolean }) => {
              if (values.folder.length > 0) {
                const targetFolder = values.folder[0];
                await onAction(targetFolder, path.basename(targetFolder), values.copy);
                pop();
              } else {
                await showToast({
                  style: Toast.Style.Failure,
                  title: "Please select a destination folder",
                });
              }
            }}
          />
        </ActionPanel>
      }
    >
      <Form.FilePicker
        id="folder"
        title="Destination Folder"
        allowMultipleSelection={false}
        canChooseDirectories={true}
        canChooseFiles={false}
      />
      <Form.Checkbox id="copy" label="Copy instead of move" defaultValue={false} />
    </Form>
  );
}

interface MoveToNewFolderFormProps {
  onAction: (destinationPath: string, folderName: string, isCopy: boolean) => Promise<void>;
}

function MoveToNewFolderForm({ onAction }: MoveToNewFolderFormProps) {
  const { pop } = useNavigation();

  return (
    <Form
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="Create & Move/Copy Files"
            onSubmit={async (values: { name: string; parentFolder: string[]; copy: boolean }) => {
              if (values.name && values.parentFolder.length > 0) {
                const safeName = path.basename(values.name);
                if (!safeName || safeName === "." || safeName === "..") {
                  await showToast({
                    style: Toast.Style.Failure,
                    title: "Invalid folder name",
                  });
                  return;
                }
                const newFolderPath = path.join(values.parentFolder[0], safeName);
                await onAction(newFolderPath, values.name, values.copy);
                pop();
              } else {
                await showToast({
                  style: Toast.Style.Failure,
                  title: "Please provide a name and location",
                });
              }
            }}
          />
        </ActionPanel>
      }
    >
      <Form.TextField id="name" title="New Folder Name" placeholder="e.g. New Project" />
      <Form.FilePicker
        id="parentFolder"
        title="Location"
        allowMultipleSelection={false}
        canChooseDirectories={true}
        canChooseFiles={false}
        defaultValue={[path.join(os.homedir(), "Desktop")]}
      />
      <Form.Checkbox id="copy" label="Copy instead of move" defaultValue={false} />
    </Form>
  );
}
