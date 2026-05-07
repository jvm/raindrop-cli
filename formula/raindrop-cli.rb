class RaindropCli < Formula
  desc "Agent-friendly CLI for Raindrop.io"
  homepage "https://github.com/jvm/raindrop-cli"
  url "https://registry.npmjs.org/@mocito/raindrop-cli/-/raindrop-cli-0.2.0.tgz"
  sha256 "385780dd0a2b926650d237115c9500d3a1b11836930bd27927d63a1fe7b0259d"
  license "MIT"

  depends_on "node"

  def install
    system "npm", "install", *std_npm_args
    bin.install_symlink libexec.glob("bin/*")
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/raindrop --version")
  end
end
