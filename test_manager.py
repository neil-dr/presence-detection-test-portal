import json
from pathlib import Path
from datetime import datetime


test_id = None


def save_test_result(
    test_id: str,
    start_time: str,
    end_time: str,
    test_type: str,
    face_detected: bool,
    detected_at: str | None,
    run_time: float
):
    """
    Save test results in JSON format inside a test_id folder.

    Args:
        test_id (str): Unique test identifier.
        start_time (str): ISO formatted start time.
        end_time (str): ISO formatted end time.
        test_type (str): "defined" or "infinite".
        face_detected (bool): Whether a face was detected.
        detected_at (str|None): ISO formatted time of detection, if any.
        run_time (float): Duration in seconds.
    """

    # Make sure we have a test_id
    if not test_id:
        raise ValueError("test_id must not be None")

    # Create folder for test
    test_dir = Path(f"test_{test_id}")
    test_dir.mkdir(parents=True, exist_ok=True)

    # Prepare result dict
    result = {
        "testId": test_id,
        "testType": test_type,
        "startTime": start_time,
        "endTime": end_time,
        "faceDetected": face_detected,
        "detectedAt": detected_at,
        "runTime": run_time,
        "savedAt": datetime.utcnow().isoformat()
    }

    # Write JSON file
    out_path = test_dir / "result.json"
    out_path.write_text(json.dumps(result, indent=2), encoding="utf-8")

    return str(out_path)  # return path for reference
