class RaindropCli < Formula
  desc "Agent-friendly CLI for Raindrop.io"
  homepage "https://github.com/jvm/raindrop-cli"
  url "https://registry.npmjs.org/@mocito/raindrop-cli/-/raindrop-cli-0.1.0.tgz"
  sha256 "6692fd6775d10417d60e3105ad485fd74e6bdc9fd5f4e174f4c76b1940d2acf3"
  license "MIT"

  depends_on "node@20"

  def install
    system "npm", "install", *std_npm_args
    bin.install_symlink libexec.glob("bin/*")
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/raindrop --version")
  end
end
