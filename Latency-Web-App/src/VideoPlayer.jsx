import React, { useState, useRef } from "react";

const VideoPlayer = () => {
  const [videoSrc, setVideoSrc] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState(null);
  const fileInputRef = useRef(null);

  const handleProcessVideo = async (file) => {
    setIsProcessing(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch("http://localhost:8000/process-video/", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Server error: ${response.status} - ${errorText}`);
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      setVideoSrc(url);
    } catch (error) {
      console.error("Error processing video:", error);
      setError(error.message);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleFileUpload = (event) => {
    const file = event.target.files[0];
    if (file && file.type.startsWith("video/")) {
      if (videoSrc) {
        URL.revokeObjectURL(videoSrc);
        setVideoSrc(null);
      }
      handleProcessVideo(file);
    } else {
      setError("Please select a valid video file.");
    }
  };

  const handleNewUpload = () => {
    if (videoSrc) {
      URL.revokeObjectURL(videoSrc);
    }
    setVideoSrc(null);
    setError(null);
    fileInputRef.current.value = "";
  };

  return (
    <div style={styles.container}>
      <h1>NSFW Video Detector</h1>

      {error && (
        <div style={styles.error}>
          <p>Error: {error}</p>
          <button onClick={() => setError(null)}>Dismiss</button>
        </div>
      )}

      {!videoSrc && !isProcessing ? (
        <div style={styles.upload}>
          <input
            ref={fileInputRef}
            type="file"
            accept="video/*"
            onChange={handleFileUpload}
            style={styles.fileInput}
          />
          <p>Select a video file to analyze</p>
        </div>
      ) : isProcessing ? (
        <div style={styles.processing}>
          <div style={styles.spinner}></div>
          <p>Processing video...</p>
        </div>
      ) : (
        <div style={styles.videoContainer}>
          <video
            src={videoSrc}
            controls
            style={styles.video}
            preload="metadata">
            Your browser does not support the video tag.
          </video>
          <button onClick={handleNewUpload} style={styles.button}>
            Upload New Video
          </button>
        </div>
      )}
    </div>
  );
};

const styles = {
  container: {
    maxWidth: "600px",
    margin: "20px auto",
    padding: "20px",
    fontFamily: "Arial, sans-serif",
    textAlign: "center",
  },
  error: {
    backgroundColor: "#fee",
    border: "1px solid #fcc",
    padding: "10px",
    borderRadius: "4px",
    marginBottom: "20px",
  },
  upload: {
    border: "2px dashed #ccc",
    padding: "40px",
    borderRadius: "8px",
  },
  fileInput: {
    marginBottom: "10px",
  },
  processing: {
    padding: "40px",
  },
  spinner: {
    width: "30px",
    height: "30px",
    border: "3px solid #f3f3f3",
    borderTop: "3px solid #333",
    borderRadius: "50%",
    animation: "spin 1s linear infinite",
    margin: "0 auto 20px",
  },
  videoContainer: {
    backgroundColor: "#f5f5f5",
    padding: "20px",
    borderRadius: "8px",
  },
  video: {
    width: "100%",
    maxWidth: "500px",
    height: "auto",
    marginBottom: "20px",
  },
  button: {
    backgroundColor: "#007bff",
    color: "white",
    border: "none",
    padding: "10px 20px",
    borderRadius: "4px",
    cursor: "pointer",
    fontSize: "14px",
  },
};

// Add spinner animation
const style = document.createElement("style");
style.textContent = `
  @keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }
`;
document.head.appendChild(style);

export default VideoPlayer;
