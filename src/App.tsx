import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';

type Results = {
  file?: string;
  output_file?: string;
  timestamp?: string;
  status?: string;
  message?: string;
};

type Data = {
  output_folder?: string;
  processing_time?: string;
  results?: Results[];
};

type Status = "Ready" | "Processing..." | "Done";

function App() {
  useEffect(() => {
    const updateCheck = async () => {
      const update = await check();
if (update) {
  console.log(
    `found update ${update.version} from ${update.date} with notes ${update.body}`
  );
  let downloaded = 0;
  let contentLength: number | undefined = 0;
  // alternatively we could also call update.download() and update.install() separately
  await update.downloadAndInstall((event) => {
    switch (event.event) {
      case 'Started':
        contentLength = event.data.contentLength;
        console.log(`started downloading ${event.data.contentLength} bytes`);
        break;
      case 'Progress':
        downloaded += event.data.chunkLength;
        console.log(`downloaded ${downloaded} from ${contentLength}`);
        break;
      case 'Finished':
        console.log('download finished');
        break;
    }
  });

  console.log('update installed');
  await relaunch();
}
    }

    updateCheck();
  }, [])
  const getValidJson = (key: string, defaultValue: any) => {
    const item = localStorage.getItem(key);
    try {
      return item ? JSON.parse(item) : defaultValue;
    } catch (e) {
      console.error(`Error parsing JSON from localStorage for key: ${key}`, e);
      return defaultValue;
    }
  };

  const input = getValidJson("inputFolder", "");
  const output = getValidJson("outputFolder", "");
  const rememberedWidth = getValidJson("width", "");
  const rememberedHeight = getValidJson("height", "");
  const rememberedKeepAspectRatio = getValidJson("keepAspectRatio", false);
  const rememberedOverwrite = getValidJson("overwrite", false);
  const rememberedRemember = getValidJson("remember", false);

  const [inputFolder, setInputFolder] = useState(
    rememberedRemember ? input : ""
  );
  const [outputFolder, setOutputFolder] = useState(
    rememberedRemember ? output : ""
  );
  const [width, setWidth] = useState(rememberedRemember ? rememberedWidth : "");
  const [height, setHeight] = useState(
    rememberedRemember ? rememberedHeight : ""
  );
  const [keepAspectRatio, setKeepAspectRatio] = useState(
    rememberedRemember ? rememberedKeepAspectRatio : false
  );
  const [overwrite, setOverwrite] = useState(
    rememberedRemember ? rememberedOverwrite : false
  );
  const [status, setStatus] = useState<Status>("Ready");
  const [data, setData] = useState<Data>({});
  const [error, setError] = useState("");
  const [remember, setRemember] = useState(
    rememberedRemember ? rememberedRemember : false
  );

  useEffect(() => {
    if (!remember) {
      localStorage.clear();
    }
  }, [remember]);

  const onRememberChange = () => {
    setRemember(!remember);
    localStorage.setItem("remember", JSON.stringify(!remember));
  };

  const setFolder = async (type: "input" | "output") => {
    const folder = await open({
      multiple: false,
      directory: true,
    });

    if (!folder) {
      setError("Please select a folder.");
      return;
    }

    if (remember) {
      if (type === "input")
        localStorage.setItem("inputFolder", JSON.stringify(folder));
      if (type === "output")
        localStorage.setItem("outputFolder", JSON.stringify(folder));
    } else {
      localStorage.removeItem("inputFolder");
      localStorage.removeItem("outputFolder");
    }

    if (type === "input") {
      setInputFolder(folder);
    } else {
      setOutputFolder(folder);
    }
  };

  const handleResize = async () => {
    if (!inputFolder || !outputFolder) {
      setError("Please fill out all required fields.");
      return;
    }

    // Parse the width and height inputs
    const widthNum = parseInt(width);
    const heightNum = parseInt(height);

    // When not keeping the aspect ratio, both width and height must be provided and valid
    if (!keepAspectRatio) {
      if (isNaN(widthNum) || isNaN(heightNum)) {
        setError("Width and height must be numbers.");
        return;
      }

      if (widthNum < 1 || heightNum < 1) {
        setError("Width and height must be greater than 0.");
        return;
      }
    } else {
      // When keeping aspect ratio, check both dimensions
      const isWidthValid = !isNaN(widthNum) && widthNum > 0; // Must be a positive number
      const isHeightValid = !isNaN(heightNum) && heightNum > 0; // Must be a positive number

      // Check if at least one is valid and greater than 0
      if (!isWidthValid && !isHeightValid) {
        setError(
          "At least one of width or height must be provided and greater than 0 when preserving aspect ratio."
        );
        return;
      }

      // Check if both are provided and if they are valid
      if (isWidthValid && isHeightValid) {
        setError(
          "Only one of width or height should be provided when preserving aspect ratio."
        );
        return;
      }

      // If either value is negative
      if (widthNum < 1 || heightNum < 1) {
        setError(
          "Width and height must be greater than 0 when preserving aspect ratio."
        );
        return;
      }
    }

    if (remember) {
      if (width) localStorage.setItem("width", JSON.stringify(width));
      if (height) localStorage.setItem("height", JSON.stringify(height));
      if (keepAspectRatio)
        localStorage.setItem(
          "keepAspectRatio",
          JSON.stringify(keepAspectRatio)
        );
      if (overwrite)
        localStorage.setItem("overwrite", JSON.stringify(overwrite));
      localStorage.setItem("remember", JSON.stringify(remember));
    } else {
      localStorage.removeItem("width");
      localStorage.removeItem("height");
      localStorage.removeItem("keepAspectRatio");
      localStorage.removeItem("overwrite");
      localStorage.removeItem("remember");
    }

    setError("");
    setStatus("Processing...");
    const result = await invoke("process_images", {
      options: {
        input_folder: inputFolder,
        output_folder: outputFolder,
        width: parseInt(width),
        height: parseInt(height),
        keep_aspect_ratio: keepAspectRatio,
        overwrite,
      },
    });

    console.log(result);

    setData(JSON.parse(result as string));

    setStatus("Done");
  };

  const openFolder = async (out: string) => {
    await invoke("open_file_explorer", {path: out})
  }

  const statusProcessingColor = {
    "Ready": "text-green-500",
    "Processing...": "text-yellow-500",
    "Done": "text-blue-500",
  }

  return (
    <div className="flex bg-gray-900 w-full min-w-max min-h-screen font-sans text-white">
      <aside className="flex flex-col gap-2 border-gray-700 bg-gray-800 p-3 border-r w-1/3">
        <h2 className="text-center text-xl text-yellow-400">Settings</h2>

        <div className="flex flex-col">
          <button
            onClick={() => setFolder("input")}
            className="bg-blue-600 hover:bg-blue-500 p-2 rounded transition duration-300"
          >
            Select Input Folder
          </button>
          <p className="text-center">{inputFolder || "No folder selected"}</p>
        </div>

        <div className="flex flex-col">
          <button
            onClick={() => setFolder("output")}
            className="bg-blue-600 hover:bg-blue-500 p-2 rounded transition duration-300"
          >
            Select Output Folder
          </button>
          <p className="text-center">{outputFolder || "No folder selected"}</p>
        </div>

        <label className="text-gray-400" htmlFor="width">
          Width
        </label>
        <input
          type="text"
          id="width"
          name="width"
          inputMode="numeric"
          pattern="^[0-9]*[1-9][0-9]*$"
          placeholder="Width"
          value={width}
          onChange={(e) => setWidth(e.target.value)}
          className="bg-gray-700 p-2 border-none rounded"
        />
        <label className="text-gray-400" htmlFor="height">
          Height
        </label>
        <input
          type="text"
          id="height"
          name="height"
          inputMode="numeric"
          pattern="^[0-9]*[1-9][0-9]*$"
          placeholder="Height"
          value={height}
          onChange={(e) => setHeight(e.target.value)}
          className="bg-gray-700 p-2 border-none rounded"
        />
        <div className="flex justify-between items-center">
          <label className="text-gray-400">Keep Aspect Ratio</label>
          <input
            type="checkbox"
            checked={keepAspectRatio}
            onChange={() => setKeepAspectRatio(!keepAspectRatio)}
            className="border-gray-300 rounded focus:ring-blue-500 w-4 h-4 text-blue-600"
          />
        </div>
        <div className="flex justify-between items-center">
          <label className="text-gray-400">Overwrite Existing</label>
          <input
            type="checkbox"
            checked={overwrite}
            onChange={() => setOverwrite(!overwrite)}
            className="border-gray-300 rounded focus:ring-blue-500 w-4 h-4 text-blue-600"
          />
        </div>

        <div className="flex justify-between items-center">
          <label className="text-gray-400">Remember Selection</label>
          <input
            type="checkbox"
            checked={remember}
            onChange={onRememberChange}
            className="border-gray-300 rounded focus:ring-blue-500 w-4 h-4 text-blue-600"
          />
        </div>

        <button
          onClick={handleResize}
          className="bg-blue-600 hover:bg-blue-500 p-3 rounded transition duration-300"
        >
          Resize Images
        </button>
      </aside>
      <main className="flex flex-col flex-1 justify-center items-center text-gray-200">
        <h1 className="mb-4 text-3xl text-blue-500">Image Resizer</h1>
        <p>Status: <span className={`${statusProcessingColor[status]}`}>{status}</span></p>
        {data.results &&
          data.results.length > 0 &&
          data.results.map((datas, index) => (
            <div key={index} className="bg-slate-800 my-2 p-2 rounded-md w-[95%]">
              {datas.file && (
                <p className="flex flex-col items-center">
                  <span className={`${
                      datas.status === "success"
                        ? "text-green-500"
                        : "text-red-500"
                    }`}>[{datas.status === "success" ? "Resized" : "Error"}]</span>{" "}
                    <span className="mx-1">[{datas.timestamp}]</span>
                  <span title="Open folder" className="bg-gray-900 hover:bg-gray-950 mx-1 p-2 rounded-md text-cyan-400 hover:cursor-pointer" onClick={() => openFolder(data.output_folder!)}>{datas.output_file}</span>
                </p>
              )}
            </div>
          ))}
        <p>
          <span className="text-orange-400">{data.processing_time}</span>
        </p>
        {error && <p className="text-red-500">{error}</p>}
      </main>
    </div>
  );
}

export default App;
