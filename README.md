To run the project:

### **Frontend (React with Vite)**

1. Navigate to the `client` folder:

   ```bash
   cd client
   ```
2. Install the required Node modules:

   ```bash
   npm install
   ```
3. Start the Vite development server on port `5173`:

   ```bash
   npm run dev
   ```

### **Backend (FastAPI Server)**

1. Ensure you have **Python 3.10.\*** installed and create a virtual environment:

   ```bash
   python3.10 -m venv venv
   venv\\Scripts\\activate # On Windows
   ```
   or
   ```bash
   py -3.10 -m venv venv_1
   venv\\Scripts\\activate # On Windows
   ```

2. Install dependencies using following commands:

   ```bash
   pip install mediapipe fastapi opencv-python ultralytics
   pip install uvicorn
   ```

   If you encounter issues, make sure the following packages are installed:

   * `mediapipe`
   * `fastapi`
   * `opencv-python`
   * `ultralytics`
   * `uvicorn`

3. Run the FastAPI server:

   ```bash
   python run.py
   ```
