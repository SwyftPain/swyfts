use colored::*;
use image::imageops::FilterType;
use image::GenericImageView;
use infer;
use serde::Deserialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Arc, Mutex};
use std::time::Instant;
use tauri::async_runtime::spawn; // Import the spawn function for async tasks

#[derive(Debug, Deserialize, Clone)]
struct ResizeOptions {
    input_folder: PathBuf,
    output_folder: PathBuf,
    width: Option<u32>,
    height: Option<u32>,
    keep_aspect_ratio: bool,
    overwrite: bool,
}

fn resize_image(
    input_path: &Path,
    output_path: &Path,
    options: &ResizeOptions,
) -> Result<(), String> {
    // Check if the file format is valid before proceeding
    let file_type = infer::get_from_path(input_path)
        .map_err(|e| format!("Error reading file: {}", e))?
        .ok_or_else(|| format!("Could not determine file type for {}", input_path.display()))?;

    if !["image/png", "image/jpeg", "image/gif", "image/webp"].contains(&file_type.mime_type()) {
        return Err(format!(
            "Unsupported format: {} (detected as {})",
            input_path.display(),
            file_type.mime_type()
        ));
    }

    let img = image::open(input_path).map_err(|e| format!("Error opening image: {}", e))?;
    let (orig_width, orig_height) = img.dimensions();

    let (width, height) = if options.keep_aspect_ratio {
        if let Some(width) = options.width {
            let height = (width as f64 / orig_width as f64 * orig_height as f64).round() as u32;
            (width, height)
        } else if let Some(height) = options.height {
            let width = (height as f64 / orig_height as f64 * orig_width as f64).round() as u32;
            (width, height)
        } else {
            return Err("Width or height required when preserving aspect ratio.".to_string());
        }
    } else {
        (
            options.width.unwrap_or(orig_width),
            options.height.unwrap_or(orig_height),
        )
    };

    let resized_img = img.resize(width, height, FilterType::Lanczos3);

    resized_img
        .save(output_path)
        .map_err(|e| format!("Error saving image: {}", e))?;

    println!(
        "{} [{}] {} {} {}",
        "[Resized]".green().bold(),
        chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
        input_path.display().to_string().cyan(),
        "->".yellow(),
        output_path.display().to_string().magenta(),
    );

    Ok(())
}

#[tauri::command]
async fn process_images(options: ResizeOptions) -> Result<String, String> {
    if !options.input_folder.exists() {
        return Err(format!(
            "Input folder does not exist: {:?}",
            options.input_folder
        ));
    }

    let valid_formats = vec!["jpg", "jpeg", "png", "gif", "webp", "PNG"];
    let results = Arc::new(Mutex::new(Vec::new())); // Use Arc and Mutex to share results across threads
    let mut handles = vec![]; // To hold thread handles
    let start = Instant::now(); // Start timer for processing time

    for entry in fs::read_dir(&options.input_folder)
        .map_err(|e| format!("Error reading directory: {}", e))?
    {
        let entry = entry.map_err(|e| format!("Error reading entry: {}", e))?;
        let path = entry.path();
        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_lowercase();

        let results = Arc::clone(&results); // Clone Arc to share with the thread
        let options = options.clone(); // Clone options to pass to the thread
        let output_folder = options.output_folder.clone(); // Clone output folder for use in the thread

        if valid_formats.contains(&ext.as_str()) {
            let handle = spawn(async move {
                // Spawn an asynchronous task
                let output_path = output_folder.join(path.file_name().unwrap());

                // Capture the current timestamp for processing
                let timestamp = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();

                let mut result = serde_json::json!( {
                    "file": path.display().to_string(),
                    "output_file": output_path.display().to_string(),
                    "timestamp": timestamp,
                    "status": "unknown",
                    "message": ""
                });

                if output_path.exists() && !options.overwrite {
                    result["status"] = serde_json::json!("skipped");
                    result["message"] = serde_json::json!("File already exists, skipping.");
                } else {
                    match resize_image(&path, &output_path, &options) {
                        Ok(_) => {
                            result["status"] = serde_json::json!("success");
                            result["message"] = serde_json::json!("Image resized successfully.");
                        }
                        Err(e) => {
                            result["status"] = serde_json::json!("error");
                            result["message"] = serde_json::json!(e);
                        }
                    }
                }

                results.lock().unwrap().push(result); // Safely push the result
            });

            handles.push(handle); // Store the task handle
        } else {
            let timestamp = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
            let mut result = serde_json::json!( {
                "file": path.display().to_string(),
                "timestamp": timestamp,
                "status": "unsupported_format",
                "message": "Unsupported file format."
            });
            results.lock().unwrap().push(result); // Push unsupported format results
        }
    }

    for handle in handles {
        handle
            .await
            .map_err(|_| "Error joining thread".to_string())?; // Wait for all tasks to finish
    }

    let elapsed_time = start.elapsed().as_secs_f64(); // Calculate elapsed time
    let locked_results = results.lock().unwrap(); // Lock the mutex

    // Prepare the final response including the processing summary
    let response = serde_json::json!({
        "output_folder": options.output_folder.display().to_string(),
        "processing_time": format!("{:.2} seconds", elapsed_time),
        "results": (*locked_results).clone(), // Clone the results for serialization
    });

    Ok(serde_json::to_string(&response).unwrap()) // Return the final response
}

#[tauri::command]
fn open_file_explorer(path: &str) {
    // Execute the command to open the file explorer
    Command::new("explorer")
        .arg(path)
        .spawn()
        .expect("Failed to open file explorer");
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![process_images, open_file_explorer])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
