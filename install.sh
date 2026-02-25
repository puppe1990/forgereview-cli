#!/bin/bash
set -e

echo "🚀 Installing ForgeReview CLI..."

# Detect OS
OS="$(uname -s)"
case "${OS}" in
    Linux*)     MACHINE=Linux;;
    Darwin*)    MACHINE=Mac;;
    *)          MACHINE="UNKNOWN:${OS}"
esac

if [ "$MACHINE" = "UNKNOWN:${OS}" ]; then
    echo "❌ Unsupported OS: ${OS}"
    exit 1
fi

# Check if npm is installed
if ! command -v npm &> /dev/null; then
    echo "❌ npm is required but not installed."
    echo "Please install Node.js from https://nodejs.org"
    exit 1
fi

# Install globally
echo "📦 Installing @forgereview/cli..."
npm install -g @forgereview/cli

# Verify installation
if command -v forgereview &> /dev/null; then
    echo "✅ ForgeReview CLI installed successfully!"
    echo ""
    forgereview --version
    echo ""
    echo "Get started with: forgereview auth login"
else
    echo "❌ Installation failed"
    exit 1
fi

