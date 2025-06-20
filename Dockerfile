# Use an official Node.js runtime as a parent image
FROM node:20-slim

# --- FIX: Install procps which contains the 'ps' command needed by Crawlee ---
# First, update the package lists, then install procps without extra prompts.
# Finally, clean up the apt cache to keep the image size down.
RUN apt-get update && apt-get install -y procps && rm -rf /var/lib/apt/lists/*

# Set the working directory for subsequent commands
WORKDIR /app

# Create a dedicated directory for persistent data (for the SQLite DB)
RUN mkdir /data

# Copy package files and install production dependencies
COPY package*.json ./
RUN npm install --omit=dev

# Copy the application source code
COPY src/ ./src/

# Expose the application port
EXPOSE 3000

# The command to run the application
CMD ["node", "src/index.js"]
